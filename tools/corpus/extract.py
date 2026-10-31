"""Cut every melodic line in the music21 corpus into phrases and write them as JSON.

Each collection (the corpus's top-level folders) is written to data/collections/<name>.json
and skipped on later runs unless --force is given. Only raw facts are written; categorising
happens in facts.ts so it can reuse the app's code.

How lines are cut, in order:
  1. after every fermata, when the line has at least two (chorales, hymns);
  2. at every rest (vocal lines, songs);
  3. anything still longer than MAX_BARS is split at barlines into near-equal windows
     (fiddle tunes and instrumental lines that never rest).

Usage: tools/corpus/.venv/bin/python -I tools/corpus/extract.py [--force] [collection ...]
"""

import json
import math
import sys
import warnings
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from fractions import Fraction
from pathlib import Path

from music21 import chord, corpus, expressions, key, meter, stream

warnings.filterwarnings("ignore")

OUT = Path(__file__).resolve().parent / "data" / "collections"

MAX_BARS = 4

# Not repertoire: test files and exercises.
SKIPPED_COLLECTIONS = {"demos", "theoryExercises"}

# Roman-numeral analyses, not notes.
SKIPPED_EXTENSIONS = {"rntxt"}

# Collections with only a file or two are reported together.
SMALL_COLLECTION_FILES = 2
OTHER = "other"

LABELS = {
    "bach": "Bach (chorales and more)",
    "palestrina": "Palestrina (masses)",
    "essenFolksong": "Essen folk songs",
    "ryansMammoth": "Ryan's Mammoth (fiddle tunes)",
    "oneills1850": "O'Neill's 1850 (Irish tunes)",
    "airdsAirs": "Aird's Airs (Scottish tunes)",
    "trecento": "Trecento songs",
    "monteverdi": "Monteverdi (madrigals)",
    "josquin": "Josquin",
    "beethoven": "Beethoven (quartets)",
    "mozart": "Mozart (quartets)",
    "haydn": "Haydn (quartets)",
    "schumann_robert": "Robert Schumann",
    "schumann_clara": "Clara Schumann",
    OTHER: "Other single works",
}

# Breve-based Renaissance metres are renotated in halved values, as modern editions do.
HALVED_TIMES = {"4/2": "4/4", "3/2": "3/4"}

TIE_CODES = {None: 0, "start": 1, "stop": 2, "continue": 3}
REST, GRACE, CHORD = 1, 2, 4


def number(value):
    return float(Fraction(value))


def collection_of(path):
    return str(path).split("/corpus/")[-1].split("/")[0]


def has_fermata(n):
    return any(isinstance(e, expressions.Fermata) for e in n.expressions)


def lines_of(score):
    """(label, part) for each single-voice line; parts with several voices on one staff are skipped."""
    parts = list(score.parts) if score.parts else [score]
    for index, part in enumerate(parts):
        if any(m.voices for m in part.getElementsByClass(stream.Measure)):
            continue
        label = (part.partName or "").strip() or f"part {index + 1}"
        yield label, part


def events_of(part):
    """Notes and rests with their bar index (counting bars as they appear, not their printed numbers)."""
    events, bar, last_measure = [], -1, None
    for n in part.recurse().notesAndRests:
        measure = n.getContextByClass(stream.Measure)
        if measure is not last_measure:
            bar += 1
            last_measure = measure
        padding = measure.paddingLeft if measure is not None else 0
        events.append((n, bar, number(n.offset + padding)))
    return events


def segments_of(events):
    """Cut at fermatas (when there are several) and rests; rests themselves are dropped."""
    use_fermatas = sum(1 for n, _, _ in events if not n.isRest and has_fermata(n)) >= 2
    segments, current = [], []
    for event in events:
        n = event[0]
        if n.isRest:
            if current:
                segments.append((current, "rest"))
            current = []
            continue
        current.append(event)
        if use_fermatas and has_fermata(n):
            segments.append((current, "fermata"))
            current = []
    if current:
        segments.append((current, "end"))
    return segments


def windows_of(segment):
    """Split a segment longer than MAX_BARS into near-equal windows of whole bars; a pickup stays with the first."""
    first_bar = segment[0][1] + (1 if segment[0][2] > 0 else 0)
    last_bar = segment[-1][1]
    bars = last_bar - first_bar + 1
    if bars <= MAX_BARS:
        return [segment]
    count = math.ceil(bars / MAX_BARS)
    windows, start = [], first_bar
    for i in range(count):
        size = bars // count + (1 if i < bars % count else 0)
        end = start + size - 1
        window = [e for e in segment if (e[1] <= end if i == 0 else start <= e[1] <= end)]
        if window:
            windows.append(window)
        start = end + 1
    return windows


def note_row(n, bar, beat, halve):
    """[bar, beat, ql, dots, tuplet, tie, flags, step, alter, octave]"""
    scale = 0.5 if halve else 1
    tuplet = 0
    if n.duration.tuplets:
        t = n.duration.tuplets[0]
        tuplet = f"{t.numberNotesActual}:{t.numberNotesNormal}"
    flags = (GRACE if n.duration.isGrace else 0) | (CHORD if isinstance(n, chord.Chord) else 0)
    pitch = n.pitches[-1] if isinstance(n, chord.Chord) else n.pitch
    alter = int(pitch.accidental.alter) if pitch.accidental else 0
    return [bar, beat * scale, number(n.quarterLength) * scale, n.duration.dots, tuplet,
            TIE_CODES.get(n.tie.type if n.tie else None, 0), flags, pitch.step, alter, pitch.octave]


def time_at(n):
    ts = n.getContextByClass(meter.TimeSignature)
    return ts.ratioString if ts else "4/4"


def key_of(notes, score_key, score_fifths):
    """The score's analysed key, unless the signature has changed by this phrase; then the phrase's own."""
    signature = notes[0].getContextByClass(key.KeySignature)
    fifths = signature.sharps if signature else 0
    analysed = score_key
    if fifths != score_fifths or analysed is None:
        try:
            analysed = stream.Stream([n for n in notes if not n.isRest]).analyze("key")
        except Exception:
            analysed = None
    if analysed is None:
        return fifths, {"step": "C", "alter": 0, "mode": "major"}
    tonic = analysed.tonic
    return fifths, {"step": tonic.step, "alter": int(tonic.accidental.alter) if tonic.accidental else 0, "mode": analysed.mode}


def mean_midi(events):
    midis = [(e[0].pitches[-1] if isinstance(e[0], chord.Chord) else e[0].pitch).midi for e in events]
    return sum(midis) / len(midis)


def phrases_of_score(score, collection, work, title):
    phrases = []
    try:
        score_key = score.analyze("key")
    except Exception:
        score_key = None
    signature = score.recurse().getElementsByClass(key.KeySignature).first()
    score_fifths = signature.sharps if signature else 0
    for label, part in lines_of(score):
        index = 0
        for segment, cut in segments_of(events_of(part)):
            for window in windows_of(segment):
                notes = [e[0] for e in window]
                times = sorted({time_at(n) for n in notes})
                time = times[0] if len(times) == 1 else time_at(notes[0])
                halve = time in HALVED_TIMES and len(times) == 1
                fifths, analysed = key_of(notes, score_key, score_fifths)
                index += 1
                phrases.append({
                    "id": f"{work}|{label}|{index}",
                    "collection": collection,
                    "work": work,
                    "title": title,
                    "voice": label,
                    "index": index,
                    # The app has one staff, so the line's register picks the clef.
                    "clef": "treble" if mean_midi(window) >= 60 else "bass",
                    "keyFifths": fifths,
                    "analyzedKey": analysed,
                    "time": HALVED_TIMES[time] if halve else time,
                    "times": [HALVED_TIMES[time]] if halve else times,
                    "halved": halve,
                    "cut": "window" if len(segment) != len(window) else cut,
                    "notes": [note_row(e[0], e[1], e[2], halve) for e in window],
                })
    return phrases


def extract_file(path):
    collection = collection_of(path)
    name = Path(str(path)).stem
    try:
        parsed = corpus.parse(path)
    except Exception as error:
        return path, [], f"{error!r:.80}"
    scores = parsed.scores if isinstance(parsed, stream.Opus) else [parsed]
    phrases = []
    for i, score in enumerate(scores):
        md = score.metadata
        title = (md.title or md.movementName) if md else None
        if title and title.endswith((".mxl", ".xml", ".krn", ".abc")):
            title = None
        work = f"{name}#{i + 1}" if len(scores) > 1 else name
        try:
            phrases.extend(phrases_of_score(score, collection, work, title))
        except Exception as error:
            return path, phrases, f"{work}: {error!r:.80}"
    return path, phrases, None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    by_collection = defaultdict(list)
    for path in corpus.getPaths():
        collection = collection_of(path)
        if collection in SKIPPED_COLLECTIONS or str(path).rsplit(".", 1)[-1] in SKIPPED_EXTENSIONS:
            continue
        by_collection[collection].append(path)
    groups = defaultdict(list)
    for collection, paths in by_collection.items():
        groups[OTHER if len(paths) <= SMALL_COLLECTION_FILES else collection].extend(paths)

    OUT.mkdir(parents=True, exist_ok=True)
    for group, paths in sorted(groups.items(), key=lambda g: len(g[1])):
        out = OUT / f"{group}.json"
        if args and group not in args:
            continue
        if out.exists() and not force:
            print(f"{group}: cached", file=sys.stderr)
            continue
        phrases, errors = [], 0
        with ProcessPoolExecutor() as pool:
            for i, (path, found, error) in enumerate(pool.map(extract_file, paths, chunksize=4)):
                phrases.extend(found)
                if error:
                    errors += 1
                print(f"\r{group}: {i + 1}/{len(paths)} files, {len(phrases)} phrases", end="", file=sys.stderr)
        print(f"{', ' + str(errors) + ' files failed' if errors else ''}", file=sys.stderr)
        out.write_text(json.dumps({"collection": group, "label": LABELS.get(group, group), "files": len(paths), "phrases": phrases}))


if __name__ == "__main__":
    main()
