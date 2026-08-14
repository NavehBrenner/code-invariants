import { expect, test } from "vitest";
import { run } from "./cli.ts";

const silent = () => {};

test("check with no rules exits 0", () => {
  expect(run(["check"], silent, silent)).toBe(0);
});

test("--help exits 0", () => {
  expect(run(["--help"], silent, silent)).toBe(0);
});

test("unknown flag exits 2", () => {
  expect(run(["check", "--nope"], silent, silent)).toBe(2);
});

test("unknown command exits 2", () => {
  expect(run(["frobnicate"], silent, silent)).toBe(2);
});

test("no arguments exits 2", () => {
  expect(run([], silent, silent)).toBe(2);
});
