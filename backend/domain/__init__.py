"""Domain layer — business rules that do not know how they were invoked.

Nothing in here imports FastAPI, reads a Request, raises HTTPException, or
touches a JWT. That is the whole point: an HTTP handler, a scheduled job, a
webhook and a public-API key can all ask the same question and get the same
answer, instead of each re-deriving the rule.

Depends on: models, database (the shared kernel). Nothing else in the app.
"""
