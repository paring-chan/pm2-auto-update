# pm2-auto-update

## Installation

```bash
pm2 set @pikokr/pm2-auto-update:port 9876 # You can use other port
pm2 set @pikokr/pm2-auto-update:secret abcdef # Use a stronger secret

pm2 install @pikokr/pm2-auto-update
```

Then, go to the webhook settings and set the following fields:

| Field       | Value                         |
| ----------- | ----------------------------- |
| Payload URL | http://host:port              |
| Secret      | The secret you previously set |

## Setup in your project

### Install script

This project automatically runs install when you have changed package.json. You can customize the command to run if package.json is changed. For example, you can use `yarn` instead of npm.

You can simply set the autoReloadInstall script on your package.json.
