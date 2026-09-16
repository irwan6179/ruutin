import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("TAC entry advances through retained inputs and accepts a complete pasted code", () => {
  const authFlow = readFileSync("app/auth/AuthFlow.tsx", "utf8");

  assert.match(authFlow, /codeInputRefs\.current\[index\] = element/u);
  assert.match(authFlow, /focusCodeInput\(Math\.min\(index \+ enteredDigits\.length, CODE_LENGTH - 1\)\)/u);
  assert.match(authFlow, /enteredDigits\.split\(""\)\.forEach/u);
  assert.match(authFlow, /onPaste=\{handleCodePaste\}/u);
  assert.match(authFlow, /maxLength=\{CODE_LENGTH\}/u);
});

test("parent routine completion uses the linked-device checkbox treatment", () => {
  const parentToday = readFileSync("app/app/today/TodayManager.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");

  assert.match(parentToday, /ruutin-parent-done-button/u);
  assert.match(parentToday, /ruutin-parent-done-check/u);
  assert.match(parentToday, /task\.state !== "todo"/u);
  assert.match(styles, /\.ruutin-parent-done-check/u);
});
