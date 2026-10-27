import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confidenceScore,
  csvEscape,
  findColumn,
  headerKey,
  parseCsv,
  parseNumber,
  rowsToObjects,
  toCsv,
} from "../src/csv.js";

test("parseCsv splits simple rows", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseCsv keeps quoted commas", () => {
  assert.deepEqual(parseCsv('name,note\n"Smith, J","hello, world"\n'), [
    ["name", "note"],
    ["Smith, J", "hello, world"],
  ]);
});

test("parseCsv unescapes doubled quotes", () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""\n'), [["a"], ['say "hi"']]);
});

test("parseCsv keeps newlines inside quotes", () => {
  const rows = parseCsv('a,b\n"line1\nline2",x\n');
  assert.deepEqual(rows[1], ["line1\nline2", "x"]);
});

test("parseCsv handles CRLF and a BOM", () => {
  const rows = parseCsv("\ufeffa,b\r\n1,2\r\n");
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseCsv keeps empty middle fields", () => {
  assert.deepEqual(parseCsv("a,,c\n"), [["a", "", "c"]]);
});

test("parseCsv returns an empty list for empty text", () => {
  assert.deepEqual(parseCsv(""), []);
});

test("toCsv quotes only when needed", () => {
  assert.equal(toCsv([["a", "b"], ["1", "2"]]), "a,b\n1,2\n");
});

test("toCsv round-trips awkward values", () => {
  const rows = [
    ["name", "note"],
    ["A, B", 'quote "inside"'],
    ["multi\nline", ""],
  ];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("csvEscape renders null and undefined as empty", () => {
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(undefined), "");
  assert.equal(csvEscape(3), "3");
});

test("headerKey normalises separators and case", () => {
  assert.equal(headerKey(" Area_Ha "), "areaha");
  assert.equal(headerKey("Latitude"), "latitude");
});

test("findColumn matches aliases", () => {
  const header = ["Name", "Lat", "Long", "Area (ha)"];
  assert.equal(findColumn(header, ["name"]), 0);
  assert.equal(findColumn(header, ["latitude", "lat"]), 1);
  assert.equal(findColumn(header, ["lon", "long", "longitude"]), 2);
  assert.equal(findColumn(header, ["missing"]), -1);
});

test("rowsToObjects maps header keys to values", () => {
  const objects = rowsToObjects([
    ["Name", "Lat"],
    ["Ridge", "-33.7"],
  ]);
  assert.deepEqual(objects, [{ name: "Ridge", lat: "-33.7" }]);
});

test("parseNumber accepts separators and rejects junk", () => {
  assert.equal(parseNumber("1,234.5"), 1234.5);
  assert.equal(parseNumber(" -3.5 "), -3.5);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber(undefined), null);
});

test("confidenceScore maps FIRMS letters and numbers", () => {
  assert.equal(confidenceScore("h"), 90);
  assert.equal(confidenceScore("N"), 60);
  assert.equal(confidenceScore("low"), 30);
  assert.equal(confidenceScore("85"), 85);
  assert.equal(confidenceScore("weird"), 0);
});