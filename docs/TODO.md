# Technical backlog

## API conventions
- `POST /api/workspace/profile` should be `PUT` (currently POST to avoid breaking client).
  Migrate to PUT in a dedicated cleanup sprint — update route method + all fetch() callers.
