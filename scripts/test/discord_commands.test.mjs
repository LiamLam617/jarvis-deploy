import assert from "node:assert/strict";
import test from "node:test";
import { desiredCommands, planCommandChanges } from "../discord_commands.mjs";

test("creates only the three Jarvis commands and keeps unrelated commands", () => {
  const existing = [{ id: "other-id", name: "another-command", type: 1 }];
  const plan = planCommandChanges(existing);
  assert.deepEqual(plan.map((item) => item.action), ["create", "create", "create"]);
  assert.deepEqual(plan.map((item) => item.command.name), ["jarvis", "capture", "status"]);
});

test("does not change matching commands", () => {
  const existing = desiredCommands.map((command, index) => ({ ...command, id: String(index + 1) }));
  assert.ok(planCommandChanges(existing).every((item) => item.action === "unchanged"));
});

test("updates only the changed command by ID", () => {
  const existing = desiredCommands.map((command, index) => ({ ...command, id: String(index + 1) }));
  existing[1] = { ...existing[1], description: "舊描述" };
  assert.deepEqual(planCommandChanges(existing).map((item) => item.action), ["unchanged", "update", "unchanged"]);
  assert.equal(planCommandChanges(existing)[1].id, "2");
});
