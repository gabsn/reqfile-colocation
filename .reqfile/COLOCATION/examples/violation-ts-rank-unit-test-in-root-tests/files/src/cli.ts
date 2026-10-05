#!/usr/bin/env bun
import { notes } from "./notes";
import { search } from "./search";

const query = process.argv.slice(2).join(" ");
for (const id of search(query, notes)) console.log(id);
