#!/usr/bin/env node
const port = Number(process.env.PORT || 9655);

fetch(`http://127.0.0.1:${port}/health`)
  .then(res => process.exit(res.ok ? 0 : 1))
  .catch(() => process.exit(1));
