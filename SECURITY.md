# Security Policy

## Supported Versions

We release security updates for the latest major version of `yt-cipher`. Please upgrade to the latest version to ensure you receive all security fixes.

| Version | Supported          |
| ------- | ----------------- |
| latest  | :white_check_mark: |
| older   | :x:               |

## Reporting a Vulnerability

If you discover a security vulnerability in `yt-cipher`, please do **not** open a public issue. Instead, report it securely by emailing **[ryan.is.nomore7@gmail.com]** with details and steps to reproduce.

We will respond as quickly as possible and coordinate a fix and disclosure timeline with you.

## Security Best Practices

- **No Sensitive Data in the Repo**: Avoid committing secrets, private keys, tokens, or passwords.
- **Keep Dependencies Updated**: Regularly update Deno and all dependencies to patch known vulnerabilities.
- **Input Validation**: Always validate and sanitize user inputs, especially if any endpoints are exposed.
- **Least Privilege**: Only grant necessary permissions to the service and any integrations.
- **Transport Security**: When deploying, use HTTPS for client/server communication.

## Responsible Disclosure

We encourage responsible disclosure of security issues. Please give us a reasonable time to address vulnerabilities before public disclosure.

## Acknowledgements

Your efforts to improve our project's security are appreciated!
