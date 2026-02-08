import { expect, test } from "bun:test";
import { shouldStopPagination } from "../src/lib/pipeline";

test("stops when hasNext is false", () => {
  expect(
    shouldStopPagination({
      currentPage: 1,
      itemsCount: 25,
      hasNext: false,
      maxPages: 500,
    }),
  ).toBe(true);
});

test("stops when page reaches totalPages", () => {
  expect(
    shouldStopPagination({
      currentPage: 2,
      itemsCount: 25,
      totalPages: 2,
      maxPages: 500,
    }),
  ).toBe(true);
});

test("stops on empty page when no metadata", () => {
  expect(
    shouldStopPagination({
      currentPage: 9,
      itemsCount: 0,
      maxPages: 500,
    }),
  ).toBe(true);
});
