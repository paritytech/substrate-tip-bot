# substrate-tip-bot

> A GitHub App built with [Probot](https://github.com/probot/probot) that A GitHub bot to submit tips on behalf of the network.

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t substrate-tip-bot .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> substrate-tip-bot
```

## Contributing

If you have suggestions for how substrate-tip-bot could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2021 Shawn Tabrizi <shawntabrizi@gmail.com>
