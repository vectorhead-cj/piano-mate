import { signIn } from "../account";

/**
 * The sign-in modal: email and password. The page reloads once signed in, so progress reopens
 * from the account. New sign-ups are off (supabase/config.toml), so there's no way to create one.
 */
export function bindAccountDialog(dialog: HTMLDialogElement): { open(): void } {
  const form = dialog.querySelector<HTMLFormElement>("[data-account-form]")!;
  const message = dialog.querySelector<HTMLElement>("[data-account-message]")!;
  const cancel = dialog.querySelector<HTMLButtonElement>("[data-account-cancel]")!;
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;

  cancel.addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email")).trim();
    const password = String(data.get("password"));
    submit.disabled = true;
    message.textContent = "Signing in…";
    try {
      await signIn(email, password);
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
      dialog.showModal();
    },
  };
}
