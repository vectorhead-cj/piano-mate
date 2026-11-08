import { requestSignInCode, signIn, verifySignInCode } from "../account";

type Mode = "email" | "code" | "password";

/**
 * The sign-in modal. By default it emails a one-time code and signs in once the code is typed,
 * so testers need no password; "Use a password instead" keeps password sign-in. The page reloads
 * once signed in, so progress reopens from the account. New sign-ups are off
 * (supabase/config.toml), so only accounts made by hand can sign in.
 */
export function bindAccountDialog(dialog: HTMLDialogElement): { open(): void } {
  const form = dialog.querySelector<HTMLFormElement>("[data-account-form]")!;
  const message = dialog.querySelector<HTMLElement>("[data-account-message]")!;
  const cancel = dialog.querySelector<HTMLButtonElement>("[data-account-cancel]")!;
  const submit = dialog.querySelector<HTMLButtonElement>("[data-account-submit]")!;
  const switcher = dialog.querySelector<HTMLButtonElement>("[data-account-switch]")!;
  const emailInput = dialog.querySelector<HTMLInputElement>("[data-account-email]")!;
  const codeHint = dialog.querySelector<HTMLElement>("[data-account-code-hint]")!;
  const steps = dialog.querySelectorAll<HTMLFieldSetElement>("[data-account-step]");
  let mode: Mode = "email";

  function show(next: Mode): void {
    mode = next;
    // A disabled fieldset's fields skip validation and stay out of the form data.
    for (const step of steps) {
      const active = step.dataset.accountStep === next;
      step.hidden = !active;
      step.disabled = !active;
    }
    emailInput.readOnly = next === "code";
    submit.textContent = next === "email" ? "Email me a code" : "Sign in";
    switcher.textContent = next === "password" ? "Email me a code instead" : next === "code" ? "Use another email" : "Use a password instead";
    if (next === "code") {
      codeHint.textContent = `We emailed a code to ${emailInput.value.trim()}. Type it here, in the browser you'll play in. You can read the email on any device.`;
      form.querySelector<HTMLInputElement>("input[name=code]")!.focus();
    }
  }

  cancel.addEventListener("click", () => dialog.close());
  switcher.addEventListener("click", () => {
    message.textContent = "";
    show(mode === "email" ? "password" : "email");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email")).trim();
    submit.disabled = true;
    try {
      if (mode === "email") {
        message.textContent = "Sending a code…";
        await requestSignInCode(email);
        message.textContent = "";
        show("code");
        return;
      }
      message.textContent = "Signing in…";
      if (mode === "code") await verifySignInCode(email, String(data.get("code")).trim());
      else await signIn(email, String(data.get("password")));
      location.reload();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      submit.disabled = false;
    }
  });

  return {
    open() {
      message.textContent = "";
      form.reset();
      show("email");
      dialog.showModal();
    },
  };
}
