# Agent Coach — Design

## Purpose

Let a player connect their own AI agent to a practice session. The player starts in a chat to connect, then moves to the piano app and stays there. The agent follows the practice events, comments when it has something useful to say, and steers practice towards the player's strengths and weaknesses.

Once connected, the app can also offer AI features of its own: contextual buttons, and perhaps a small chat, all answered by the player's agent.

Nothing here is implemented yet. This is a brainstorm written down, and nothing has been tested. The biggest unknown is how long agent clients will keep the loop running (see [Risks](#risks)).

## Shape

```
Piano app ──events, requests──▶ Supabase ◀──tools── MCP server ◀── player's agent
    ▲                              │
    └────── messages, actions ─────┘  (Realtime push to the browser)
```

MCP is usually how an agent reaches an outside tool while the user stays in the chat. Here the user stays in the app, and the chat is just where the agent runs. The MCP server is a mailbox between the two, sitting on top of the backend we already have.

- `practice_events` is append-only, with `type` and `at` columns to read it by, so it can serve as the agent's feed.
- RLS is already per-user, so an agent logged in as a player can only see that player's data.
- The app has no Realtime subscriptions or edge functions yet. Both would be new.

## Decisions

### 1. The agent gets a small set of tools

| Tool | Purpose |
|---|---|
| `wait_for_events(cursor, timeout_seconds)` | Block until something meaningful happens, then return it |
| `get_player_summary()` | Strengths, weaknesses and recent history; also how an agent recovers after losing its context |
| `message_user(text, practice_event_id?)` | Show a message in the app, optionally tied to an attempt |
| `set_exercise(...)`, `suggest_focus(...)` | Steer practice |
| `propose_phrases(piece_id, phrases)` | Return a structured result the app can preview |

Steering tools are typed actions, not free text, and the app decides whether and when to apply them. It shouldn't swap the exercise mid-attempt, for example.

### 2. The loop lives in a skill

`wait_for_events` is our own tool, not a feature of Claude or MCP. It's an ordinary tool call that long-polls: the server holds the request open until there's something to return. The model isn't running while it waits, so waiting uses no tokens.

A skill on the agent's side tells it to stay in one long turn:

1. Call `wait_for_events(cursor)`.
2. Analyze the result, and call `message_user` or a steering tool only if it's worth it.
3. Repeat until the result says `session_ended: true`.

```jsonc
// Agent sends
{ "cursor": "evt_1041", "timeout_seconds": 30 }

// Server returns
{
  "cursor": "evt_1043",
  "events": [{
    "id": "evt_1043",
    "summary": "Bars 5-8, attempt 3: left hand late on beat 3"
  }],
  "session_ended": false
}
```

A quiet period ends in a timeout and an empty result, and the agent calls again. The player never has to go back to the chat. A result can say so directly: `{ "events": [], "next": "call wait_for_events again" }`.

Events that arrive while the agent is thinking aren't lost, because they're already in the event log and the cursor picks them up on the next call.

The agent's memory of the session is just its context. It only has to carry the cursor between calls.

### 3. A blocking tool, not polling on a schedule

Every poll on a schedule is a full model turn, which costs money even when nothing has happened. A blocking call only wakes the model when there's something to analyze, and an event gets through as soon as it happens.

Scheduling features don't fit anyway, as of November 2026:

| Product | Shortest interval | Fits? |
|---|---|---|
| Claude chat | No loop feature found | No |
| Cowork scheduled tasks | Reportedly one hour in the desktop UI | No: each run is a new session, so the coach would forget the practice so far |
| Claude Code `/loop` | One minute | Partly: fine for testing, slow for coaching |
| Claude Code channels | None: the server pushes into the open session | Yes, but only in Claude Code |

If more clients adopt push, the tools can stay the same and only the loop changes.

### 4. The agent coaches between attempts, not between notes

An agent turn takes seconds, so the app keeps handling instant feedback. The agent only sees attempt-level events, as compact summaries rather than raw notes. That also keeps long sessions affordable, since every loop adds to the context.

### 5. Quiet by default

A coach that comments on everything gets annoying fast. Code decides what's meaningful, so `wait_for_events` only returns then, and the skill tells the agent that saying nothing is a normal outcome. The player can always dismiss or mute the coach.

### 6. App features appear while an agent is connected

An open `wait_for_events` call doubles as a heartbeat. If the agent called in the last minute or so, the app shows the AI features. If not, it hides them and shows that the coach has gone quiet.

- **Buttons** are canned requests with context attached, such as "suggest a phrase-splitting of this new piece based on my strengths":

  ```json
  { "type": "user_request", "action": "suggest_phrasing", "piece_id": "..." }
  ```

- **Chat** uses the same mechanism: the player's text goes out through `wait_for_events`, and the reply comes back through `message_user`. Replies take seconds, so it needs a "thinking" state.
- **Requests go first.** The server returns direct requests ahead of practice events.
- **Results are structured where possible.** Phrase splitting comes back through `propose_phrases`, so the app can draw the split on the score and let the player accept or tweak it. This is probably the most compelling part of the idea, because the agent changes something in the app instead of just talking.

This gives us app-to-agent messaging while the loop is alive. Nothing can start an agent that isn't already listening, apart from the Claude Code channels above.

A possible extension: the skill declares what the agent can do when it connects, and the app only shows matching buttons. Different agents or skills could then offer different features.

### 7. Connection and security

- The agent gets its own login, through OAuth or a short pairing code shown in the app, with access limited to one user. It never sees our Supabase keys.
- The server works out the user from that login. The agent never passes a user ID, or one user could message another.
- Agent text is untrusted: the app renders it as plain text, and steering stays limited to the typed actions.
- User-provided text, such as piece titles, reaches an agent that may have other tools connected, like email. The server passes it along clearly marked as data.

## Delivering messages to the app

`message_user` is what the agent calls. How the message reaches the browser is a separate choice, and the agent can't tell the difference, so it can change later without touching the skill.

| | Table (`coach_directives`) | Supabase Broadcast only |
|---|---|---|
| **Setup** | Migration, RLS policies and a Realtime subscription | No schema, just a channel subscription |
| **Tab closed or reconnecting** | Message waits and can be picked up later | Message is lost |
| **Stale messages** | Needs an expiry, or "ease off bar 5" could appear tomorrow | Not a problem: old messages vanish |
| **History** | We can review what the coach said and whether it helped | None, unless the app logs it |
| **Agent loses its context** | It can reread what it told the player | It may repeat itself |
| **Delivery status** | Can record delivered, dismissed or applied | Nothing built in |
| **Privacy** | Stores more about the user | Nothing stored |

The current lean is the table, with a short expiry. Lost comments are tolerable, but lost steering actions aren't, and history is how we'd find out whether the coaching works. It also fits the append-only design. A first test could use Broadcast and switch later.

## Risks

- **Client limits.** Clients may cap tool calls, turn length, or how long one call can block. If a turn ends, nothing in MCP can restart it, so the player has to go back to the chat. Timeouts should start short, around 30 seconds, and be tuned from there.
- **Client differences.** Any MCP client can call the tools, but whether it keeps looping varies. The skill format may not carry over either, so the same instructions might need to live in the MCP server's own instructions or prompts.
- **Relying on unpromised behaviour.** The tools are normal MCP and long-polling is a standard web technique, but keeping one turn alive as a background process is a stretch. Clients are designed around a user waiting on the chat, so this could break without warning.
- **Context growth.** Every loop adds to the transcript, and chat adds more. Empty timeouts should return almost nothing.
- **Audience.** Most piano students won't have an agent running in a loop, so this suits power users at first.
- **Coaching quality.** The plumbing is straightforward, but good advice from our event data isn't guaranteed.

## Alternative: a tutor built into the app

If the loop proves too fragile, or for players without an agent, our backend could run the tutor. An edge function holds the API key, gets called on meaningful events, calls a model, and replies through the same delivery path. There's no loop to keep alive, but we pay for inference and need per-user quotas from day one.

The player's Claude subscription can't pay for this: Anthropic doesn't let third-party apps offer Claude login or use a user's plan credentials. Running their own agent over MCP is the legitimate way to use a subscription, since our app never touches their credentials.

Rough cost, assuming 40 calls in a 30-minute session, each 3,000 tokens in and 300 out, at October 2026 prices. These are estimates, before prompt caching:

| Model | Per session | 20 sessions a month |
|---|---|---|
| Haiku 5.5 | about $0.02 | about $0.36 |
| Sonnet 5.5 | about $0.36 | about $7 |
| Opus 5.5 | about $0.72 | about $14 |

Ways to fund it: absorb the cost with caps, add a paid tier, or let users pay through OpenRouter sign-in or their own API key.

The two approaches can share event summaries and message delivery, so we could end up with a built-in tutor for everyone and bring-your-own-agent for power users.

## Testing the idea

Two cheap tests come before building the real thing:

1. **Is the advice any good?** Export a real session's events, give them to a model, and see whether its advice beats what the app already tells the player. Trying Haiku, Sonnet and Opus also shows which model is good enough, and so whether a built-in tutor would need payments.
2. **Does the loop hold up?** Run the blocking loop against a fake event source, in Claude Code and in Claude chat, and see how long each lasts. If it survives a 30-minute practice session, the skill-based approach works.

If both pass, build in this order:

1. MCP server with `get_player_summary`, `wait_for_events` and `message_user`, plus a coach message area in the app.
2. Steering tools, once the comments prove useful.
3. Contextual buttons and structured results like `propose_phrases`.
4. Chat.

## Open questions

- What counts as "meaningful"? Every finished attempt, or only patterns code detects, like three failures in a row? This sets both the cost and how the coach feels to the player.
- Table or Broadcast for message delivery, and what expiry?
- Do coach messages belong in `practice_events`, or in their own table?
- OAuth or pairing code for connecting?
- What does the player see when the coach disconnects, and how do they get it back with as little fuss as possible?
- Which clients do we support at first?
