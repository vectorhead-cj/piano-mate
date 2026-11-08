import { describe, expect, it } from "vitest";
import { signInCodeMessage } from "../src/account";

describe("signInCodeMessage", () => {
  it("explains a missing account as invite-only", () => {
    expect(signInCodeMessage("Signups not allowed for otp")).toMatch(/invite-only/);
  });

  it("explains a bad or expired code", () => {
    expect(signInCodeMessage("Token has expired or is invalid")).toMatch(/wrong or has expired/);
  });

  it("explains rate limiting", () => {
    expect(signInCodeMessage("email rate limit exceeded")).toMatch(/Too many emails/);
    expect(signInCodeMessage("For security purposes, you can only request this after 42 seconds.")).toMatch(/Too many emails/);
  });

  it("passes other messages through", () => {
    expect(signInCodeMessage("Network down")).toBe("Network down");
  });
});
