import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(
  new URL("../artifacts/api-server/src/lib/demoSeed.ts", import.meta.url),
);
const source = await readFile(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  sourcePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

if (sourceFile.parseDiagnostics.length > 0) {
  throw new Error("Could not parse the demo seed source.");
}

function propertyName(property) {
  if (!property.name) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return undefined;
}

function getProperty(object, name) {
  if (!ts.isObjectLiteralExpression(object)) return undefined;
  const property = object.properties.find(
    (item) => ts.isPropertyAssignment(item) && propertyName(item) === name,
  );
  return property?.initializer;
}

function getString(node) {
  if (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }
  return undefined;
}

function getArrayDeclaration(name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(sourceFile) !== name) continue;
      let initializer = declaration.initializer;
      while (
        initializer &&
        (ts.isAsExpression(initializer) ||
          ts.isSatisfiesExpression(initializer) ||
          ts.isTypeAssertionExpression(initializer) ||
          ts.isParenthesizedExpression(initializer))
      ) {
        initializer = initializer.expression;
      }
      if (initializer && ts.isArrayLiteralExpression(initializer)) {
        return initializer.elements;
      }
    }
  }
  throw new Error(`Could not find the ${name} sample data.`);
}

const copyItems = [];
function addCopy(location, value) {
  if (value !== undefined) copyItems.push({ location, value });
}

for (const [index, item] of getArrayDeclaration("LABELS").entries()) {
  addCopy(`label ${index + 1} name`, getString(getProperty(item, "name")));
}

for (const [index, item] of getArrayDeclaration("STARS").entries()) {
  const key = getString(getProperty(item, "key")) ?? `item ${index + 1}`;
  addCopy(`star "${key}" title`, getString(getProperty(item, "title")));

  const notes = getProperty(item, "notes");
  if (!notes || !ts.isArrayLiteralExpression(notes)) {
    throw new Error(`Could not read notes for star "${key}".`);
  }
  for (const [noteIndex, note] of notes.elements.entries()) {
    if (!ts.isArrayLiteralExpression(note)) continue;
    addCopy(
      `note ${noteIndex + 1} on star "${key}"`,
      getString(note.elements[1]),
    );
  }
}

for (const [index, item] of getArrayDeclaration("TASKS").entries()) {
  const star = getString(getProperty(item, "star")) ?? "unknown star";
  addCopy(
    `task ${index + 1} on star "${star}"`,
    getString(getProperty(item, "title")),
  );
}

for (const [index, item] of getArrayDeclaration("CONSTELLATIONS").entries()) {
  if (ts.isArrayLiteralExpression(item)) {
    addCopy(`constellation ${index + 1} name`, getString(item.elements[0]));
  }
}

function visitOnThisDayBody(node) {
  if (
    ts.isPropertyAssignment(node) &&
    propertyName(node) === "body" &&
    getString(node.initializer) !== undefined
  ) {
    addCopy("On This Day sample note", getString(node.initializer));
  }
  ts.forEachChild(node, visitOnThisDayBody);
}
visitOnThisDayBody(sourceFile);

const contactPatterns = [
  {
    type: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
  {
    type: "phone number",
    pattern:
      /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)|(?<!\w)\+(?:\d[\s().-]*){8,14}\d(?!\w)/,
  },
  {
    type: "street address",
    pattern:
      /\b\d{1,6}\s+[\p{L}\d.'-]+(?:\s+[\p{L}\d.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|parkway|pkwy)\b/iu,
  },
  {
    type: "website link",
    pattern: /\b(?:https?:\/\/|www\.)\S+/i,
  },
  {
    type: "social media handle",
    pattern: /(?<![\w.+-])@[A-Z0-9_]{2,}/i,
  },
];

function findContactDetails(value) {
  return contactPatterns
    .filter(({ pattern }) => pattern.test(value))
    .map(({ type }) => type);
}

const detectorExamples = [
  ["Contact alex@example.test", "email address"],
  ["Call +1 (415) 555-0100", "phone number"],
  ["Meet at 14 Oak Street", "street address"],
  ["Visit https://example.test", "website link"],
  ["Follow @starlog_dev", "social media handle"],
];
for (const [example, expectedType] of detectorExamples) {
  if (!findContactDetails(example).includes(expectedType)) {
    throw new Error(
      `The privacy check did not recognize a ${expectedType} example.`,
    );
  }
}
if (findContactDetails("A dog on the bus wearing a tiny raincoat").length > 0) {
  throw new Error(
    "The privacy check incorrectly flagged ordinary sample copy.",
  );
}

if (copyItems.length === 0) {
  throw new Error("No user-visible demo sample copy was scanned.");
}

const findings = copyItems.flatMap(({ location, value }) =>
  findContactDetails(value).map((type) => ({ location, type })),
);

if (findings.length > 0) {
  console.error("Demo sample privacy check failed:");
  for (const { location, type } of findings) {
    console.error(`- ${location}: ${type} detected.`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Demo sample privacy check passed (${copyItems.length} sample items scanned).`,
  );
}
