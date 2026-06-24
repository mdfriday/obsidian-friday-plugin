# Source Policy

Use this before packaging an app from an application name or repository URL.

## Required Source Flow

1. If the user provides a repository URL, use that repository as the primary source of truth.
2. Do not search for alternative repositories when the provided repository contains enough official Docker installation information.
3. If the provided repository links to official documentation, use those docs as supporting evidence.
4. If the user provides only an app name, search mainstream open-source code hosts first, such as GitHub, Gitee, GitLab, Codeberg, or another well-known project-owned repository host.
5. Confirm the chosen repository is official from trustworthy signals:
   - official website linking to the repository
   - verified organization or project-owned GitHub/Gitee/GitLab namespace
   - package docs linking back to the repository
6. Fetch or inspect the source repository before generating the app package.
7. Read repository files that commonly define container installation:
   - `README.md`
   - `docs/**`
   - `docker-compose.yml`
   - `docker-compose.yaml`
   - `compose.yml`
   - `Dockerfile`
   - `.env.example`
   - deployment or installation docs
8. Use official documentation only when it is linked from the repository, project website, or project-owned docs domain.
9. For every persistent volume, check official runtime-user evidence:
   - `USER` in `Dockerfile`
   - `user:` in official Compose files
   - UID/GID notes in official image or deployment docs
   - startup errors or permission notes documented by the project
10. If a persisted host mount must be writable by a non-root container user, record the UID/GID and generate `scripts/init.sh` through `init_permissions` or `volume_permissions`.
11. If any other `init.sh` action is needed, use only project-owned repository files or official docs as evidence and record it in `init_source_evidence`.
12. Use the official repository README, official website, or official docs for `README.md` and `README_en.md` content. Keep the generated copy factual and concise.
13. Prefer official container images. Use a third-party image only when:
   - the official project has no public image or only documents source builds
   - the user explicitly accepts the third-party image
   - the third-party image page or source repository clearly identifies the upstream project
   - the spec and final response record that the image is third-party

## Allowed Evidence

The Docker installation method must be supported by at least one of:

- A Compose file in the official repository.
- A Dockerfile in the official repository plus official run instructions.
- Official documentation that explicitly describes Docker or Docker Compose installation.
- Official release/package documentation from the project owner.
- Official Dockerfile, Compose, or image docs that define the runtime user for persistent volume ownership.
- Official docs that require host-side preflight actions before container startup.
- Official README, website, or docs that describe the application and its user-facing features.
- A user-approved third-party image page or linked source repository, but only after official image absence or source-build-only status has been confirmed from official sources.

Record Docker installation evidence in `source_evidence` and summarize it in the final response.

## Not Allowed

Do not use these as authoritative sources:

- random blog posts or tutorials
- unrelated Docker Hub pages
- third-party Docker images when the official project already provides a usable public image
- third-party compose snippets
- forum answers
- mirrors that are not linked by the project
- guessed ports, volumes, env vars, or image names
- guessed UID/GID values for mounted directory ownership
- guessed init scripts or third-party shell snippets
- marketing copy, feature lists, or translations invented without source support

## Stop Conditions

Stop and explain what is missing when:

- no official source repository can be identified
- the repository and official docs have no Docker installation path
- the only available Docker instructions are third-party or unverifiable
- a third-party image is required but the user has not explicitly accepted it
- the app is not containerizable without building a custom image and no reliable build path is documented
- a persistent volume has a known permission issue, but the official source does not reveal the required UID/GID

In these cases, ask the user to provide an official Docker image, a trusted Compose file, or the intended containerization method.
