import { signIn, signUp } from "../account";

/**
 * The sign-in modal: email and password, signing in or creating an account. The page reloads
 * once signed in, so progress reopens from the account.
 */
export function bindAccountDialog(dialog: HTMLDialogElement): { open(): void } {
  const form = dialog.querySelector<HTMLFormElement>("[data-account-form]")!;
  const message = dialog.querySelector<HTMLElement>("[data-account-message]")!;
  const cancel = dialog.querySelector<HTMLButtonElement>("[data-account-cancel]")!;
  const submits = [...form.querySelectorAll<HTMLButtonElement>("button[type=submit]")];

  cancel.addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const creating = (event.submitter as HTMLButtonElement | null)?.value === "sign-up";
    const data = new FormData(form);
    const email = String(data.get("email")).trim();
    const password = String(data.get("password"));
    for (const button of submits) button.disabled = true;
    message.textContent = creating ? "Creating your account…" : "Signing in…";
    try {
      if (creating && (await signUp(email, password)) === "confirm-email") {
        message.textContent = `Check ${email} for a link to confirm your account. It brings you back here, signed in.`;
        return;
      }
      if (!creating) await signIn(email, password);
      location.reload();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      for (const button of submits) button.disabled = false;
    }
  });

  return {
    open() {
      message.textContent = "";
      dialog.showModal();
    },
  };
}
