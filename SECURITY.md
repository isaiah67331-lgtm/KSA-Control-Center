# Security

Please avoid publishing sensitive paths, tokens, or saves in bug reports.

The renderer runs with context isolation, sandboxing, and no Node.js integration. It can request only named actions. The main process selects download URLs from the catalog and restricts release redirects to GitHub asset hosts.

ZIPs are staged and validated before the installed mod is replaced. Backups are retained. Mod packages are executable third-party code; package validation is not a code audit.

For a suspected vulnerability, share a minimal reproduction without personal data with the repository maintainer. No private security contact has been configured for this unpublished project.

