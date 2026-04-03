------
title: Multiple toolcalling tests
created-at: 02/04/2026, 15:46:43
order: 1
author: CypherPotato
------
Add a new test: "Advanced tool calling", which tests:
- if the model can call complex functions, with multiple parameters and nested parameters
- if the model can call functions in parallel
- run this test three times – if calling the tools, getting their schemas and expectations right: failure: <90%, ok: <100%, perfect: =100%

so, you simplify the tool testing inputs to a single test, but you can choose between:
- simple test
- parallel test
- advanced test (the one I mentioned above)