# Features

Each domain feature belongs in its own folder under `src/features`. A feature
may contain its server-side services, queries, mutations, validation schemas,
types, and feature-specific components. Route files in `src/app` should remain
thin composition points.

The first module, `lead-workbench`, owns the companies, contacts, pipeline,
CSV import, AI actions, audit view, and settings view. Keep new lead-domain
behavior inside that folder and expose only intentional public exports.
