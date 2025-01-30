# Folder Sync to IPFS

A simple Node.js application that provides one-way synchronization of a local folder to IPFS via Pinata.

## Warning

> **⚠️ Warning:** Configuring this tool incorrectly can result in unpinning all your files from IPFS. It is highly recommended to use this tool on a test account first to ensure that your configuration is correct and to avoid any potential data loss.

## Features

- Automatic folder monitoring for changes
- Real-time IPFS uploads via Pinata
- File change detection and synchronization
- Express server for status monitoring

## Prerequisites

- Node.js (v20 or higher)
- A Pinata account with API credentials
- IPFS knowledge (basic understanding)

## Installation

Seriously, read the warning above.

1. Clone the repository:

```bash
git clone https://github.com/NTBooks/folder-sync-test.git
cd folder-sync-test
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory and add your Pinata API credentials:

```bash
PINATA_JWT=your_pinata_jwt
WATCH_GROUP=your_pinata_group_id
WATCH_DIRECTORY=path/to/your/folder
FILEPORT=3000 # port to serve the folder listener
DEMOPORT=3001 # port to serve the demo page
USECRON=true # true or false to use cron to sync the folder
MANAGED_GROUPS=DEV,TEST # comma separated list of groups to manage, if not set, files will be queried from all groups
```

4. Start the server:

```bash
npm start
```

## Usage

The application will automatically monitor the specified directory for changes and upload new or modified files to IPFS.

## Contributing

This project is not open for contributions but feel free to fork it and use it as a starting point for your own project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
