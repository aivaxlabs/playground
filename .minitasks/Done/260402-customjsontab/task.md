------
title: Custom JSON tab
created-at: 02/04/2026, 15:57:19
order: 8
author: CypherPotato
------
Add a "Custom JSON" flag after the "Structured JSON" tab. This tab will define a user‑customized JSON that will, recursively, concatenate data into the request JSON.

You will take this JSON and merge it into the request JSON, considering parent and child keys.

Example request:
{
    "request_options": {
        "foo": "bar"
    }
}

Custom JSON:
{
    "request_options": {
        "bar": "daz"
    }
}

Merged JSON:
{
    "request_options": {
        "foo": "bar",
        "bar": "daz"
    }
}

After that, change the “Structured JSON” tab to insert the value directly into { response_format: {type: json_schema, json_schema: { name: response_schema, schema: <what the user typed> }}}

this is for the user to type only the output schema, not the initial markup.

Update the structured json examples too.