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
WATCH_DIRECTORY=path/to/your/folder
MANAGED_GROUPS=DEV,TEST # comma separated list of groups to manage (subfolders in the watch directory), if not set, files will be queried from all groups
FILEPORT=3000 # port to serve the folder listener
DEMOPORT=3001 # port to serve the demo page
USECRON=true # true or false to use cron to sync the folder

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

## Future Development Ideas

Here are some ideas for future development to enhance the functionality, performance, and security of the application:

1. **File Caches**:

   - Implement a caching mechanism to store file metadata and hashes locally. This can reduce the number of file system reads and improve performance, especially for large directories.
   - Use a database or in-memory store like Sqlite to cache file information and reduce redundant processing.

2. **Triggering from Webhooks**:

   - Integrate with webhooks to trigger synchronization events. This can be useful for real-time updates and reducing the need for constant polling.
   - For example, set up webhooks to listen for file changes from cloud storage services or other external systems.

3. **Optimizations**:

   - Optimize the file reading and processing logic to handle large directories more efficiently.
   - Implement parallel processing for reading directories and uploading files to IPFS to speed up the synchronization process.

4. **Security Enhancements**:

   - Implement authentication and authorization mechanisms to restrict access to the upload and delete endpoints.
   - Sanitize all user inputs, including filenames and query parameters, to prevent injection attacks and other security vulnerabilities.
   - Add rate limiting to prevent abuse of the upload and delete endpoints.
   - Use HTTPS to encrypt data in transit and ensure secure communication between the client and server.

5. **Error Handling and Logging**:

   - Improve error handling to provide more informative error messages and better user experience.
   - Implement a logging system to track application events, errors, and user actions for debugging and monitoring purposes.

6. **User Interface Improvements**:

   - Enhance the web interface to provide a more user-friendly experience, including progress indicators for file uploads and deletions.
   - Add support for drag-and-drop file uploads to make it easier for users to upload files.

7. **Configuration Management**:
   - Allow dynamic configuration changes without restarting the server. This can be useful for updating environment variables or application settings on the fly.
   - Provide a web-based admin interface to manage configuration settings and monitor application status.
