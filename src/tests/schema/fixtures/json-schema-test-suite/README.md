# JSON-Schema-Test-Suite (vendored subset)

Files in this directory are copied unmodified from
[json-schema-org/JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite),
directory `tests/draft2020-12/`, at commit
`5b0ee1613e45fcc2bddac00e07c19cd49b00d8a8`.

They are distributed under the upstream MIT license, reproduced in
[LICENSE](./LICENSE) (Copyright (c) 2012 Julian Berman).

`src/tests/schema/JsonSchemaTestSuite.test.ts` runs every group through
`schema/Schema.fromJsonSchema` + `schema/Validate`: a group must either be
rejected (`Err`) or agree with every `valid` verdict. To update, copy the same
file names from a newer upstream commit and bump the hash above.

`optional/format/` holds `email.json`, `uri.json`, `uuid.json`, `ipv4.json`,
`ipv6.json` and `unknown.json` from `tests/draft2020-12/optional/format/` at
the same commit; every case must agree (no exceptions). The suite's
`date.json`, `date-time.json` and `time.json` are vendored once, in
`src/tests/fixtures/json-schema-test-suite/`, and reused from there.
