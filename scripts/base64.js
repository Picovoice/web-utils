#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { program } = require("commander");

program
.requiredOption(
  "-i, --input_file <string>",
  "Path to input file to transform into base64 js file"
)
.requiredOption(
  "-o, --output_file <string>",
  "Path to output file to save transformed base64 js file"
)
.option(
  "-n, --name <string>",
  "Custom name of base64 variable for iife",
  "modelParams"
);

if (process.argv.length < 3) {
  program.help();
}

program.parse(process.argv);

const options = program.opts();

const input = options["input_file"];
const output = options["output_file"];
const outputDir = path.dirname(output);
const name = options["name"];

if (!fs.existsSync(input)) {
  console.error(`Input file '${input}' is not a valid path.`);
  process.exit(1);
}

if (fs.statSync(input).isDirectory()) {
  console.error(`Input file '${input}' is a directory.`);
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`Encoding '${input}'`);
const content = fs.readFileSync(input, { encoding: 'base64' });
fs.writeFileSync(output, `
var ${name} = "${content}";

(function() {
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined')
    module.exports = ${name}
})(); 
`);
console.log(`Done! Saved file to '${output}'.`)
