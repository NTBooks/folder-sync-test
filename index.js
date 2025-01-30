require('dotenv').config();
const express = require('express');
const chokidar = require('chokidar');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const Hash = require('ipfs-only-hash');

const app = express();
app.use(express.json());

if (!process.env.PINATA_JWT || !process.env.WATCH_DIRECTORY) {
    console.error('Missing required environment variables: PINATA_JWT, WATCH_DIRECTORY');
    process.exit(1);
}

async function delay(seconds) {
    for (let i = seconds; i > 0; i--) {
        console.log(`Retrying in ${i} second(s)...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function fetchWithRetry(url, options, retries = 3) {
    console.log("FETCH: ", options.method, url);
    for (let i = 0; i < retries; i++) {
        const response = await fetch(url, options);
        if (response.status !== 429) {

            return response;
        }
        console.warn('Received 429 Too Many Requests, retrying...');
        await delay(10);
    }
    throw new Error('Max retries reached');
}


const remoteService = {
    async listFolder(rootGroup) {
        let allFiles = [];
        let pageOffset = 0;
        let data;
        let pageLimit = 1000;

        let hasMoreFiles = true;
        while (hasMoreFiles) {
            const response = await fetchWithRetry(`https://api.pinata.cloud/data/pinList?groupId=${rootGroup}&status=pinned&pageLimit=${pageLimit}&pageOffset=${pageOffset}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${process.env.PINATA_JWT}`
                }
            });
            data = await response.json();
            allFiles = allFiles.concat(data.rows);
            pageOffset += pageLimit;
            hasMoreFiles = data.rows.length === pageLimit;
        }

        return allFiles.filter(file =>
            // filter out files that are not in the watch directory but were uploaded manually to pinata
            file.metadata.keyvalues?.localfolder)
            .map(file => ({
                path: file.metadata.name,
                hash: file.ipfs_pin_hash
            }));
    },

    async uploadFile(filePath, content, group) {
        console.log('Uploading file:', filePath);
        const fileName = filePath.split(path.sep).pop();
        const formData = new FormData();
        formData.append('file', new Blob([content]), fileName);




        if (group) {
            formData.append('pinataOptions', JSON.stringify({
                cidVersion: 0,
                groupId: group
            }));
        }

        formData.append('pinataMetadata', JSON.stringify({
            name: fileName,
            keyvalues: {
                localfolder: process.env.WATCH_DIRECTORY,
                localfile: filePath

            }
        }));

        const response = await fetchWithRetry('https://api.pinata.cloud/pinning/pinFileToIPFS', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PINATA_JWT}`
            },
            body: formData
        });

        const data = await response.json();

        if (data.error) {
            console.error(data.error);
            throw new Error(data.error.message);
        }

        return { success: true, hash: data.IpfsHash };

    },

    async deleteFile(fileHash) {
        const response = await fetchWithRetry(`https://api.pinata.cloud/pinning/unpin/${fileHash}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${process.env.PINATA_JWT}`
            }
        });

        if (!response.ok) {
            console.log(response);
            const data = await response.json();
            if (data.error?.message) {
                console.log(data.error.details);
            }
            return { success: false, message: data.message };
        }

        const textResult = await response.text();

        return { success: textResult === 'OK' };
    },

    async listRemoteGroups() {
        const response = await fetchWithRetry('https://api.pinata.cloud/groups', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.PINATA_JWT}`
            }
        });

        if (!response.ok) {
            const data = await response.json();
            return { success: false, message: data.message };
        }

        const data = await response.json();
        return { success: true, groups: data };
    },

    async addNewGroup(groupName) {
        const response = await fetchWithRetry('https://api.pinata.cloud/groups', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PINATA_JWT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: groupName,
            })
        });

        if (!response.ok) {
            const data = await response.json();
            return { success: false, message: data.message };
        }

        const data = await response.json();
        return { success: true, groupId: data.id };
    }
};


// File tracking and sync logic
class SyncManager {
    constructor(watchDir) {
        this.watchDir = watchDir;

        this.isSyncing = false;
    }

    async calculateFileHash(filePath) {
        const fileContent = await fs.readFile(filePath);
        return await Hash.of(fileContent);

    }

    async getRemoteGroups() {
        const groups = await remoteService.listRemoteGroups();
        // create lookup of group name to group id
        const groupLookup = [];
        for (const group of groups.groups) {
            groupLookup.push({ name: group.name, id: group.id });
        }
        return groupLookup;
    }




    async getLocalFiles() {
        const files = [];

        const readDir = async (dir) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(this.watchDir, fullPath);

                if (entry.isDirectory()) {
                    await readDir(fullPath);
                } else {
                    const hash = await this.calculateFileHash(fullPath);
                    files.push({ path: relativePath, hash });
                }
            }
        };

        await readDir(this.watchDir);
        return files.filter(f => !f.path.endsWith('.meta'));
    }

    async getLocalFolders() {
        const files = await this.getLocalFiles();
        return files.filter(f => f.path.includes(path.sep)).map(f => f.path.split(path.sep)[0]);
    }


    async sync() {

        // Each file triggers a sync, so we need to check if it's already syncing
        if (this.isSyncing) {
            // quiet return
            return;
        }

        try {
            this.isSyncing = true;
            console.log('Starting sync...');

            const remoteGroups = await this.getRemoteGroups();
            const localFolders = [...new Set(await this.getLocalFolders())];


            const [localFiles, remoteFiles] = await Promise.all([
                this.getLocalFiles(),
                (await Promise.all(remoteGroups.map(group => remoteService.listFolder(group.id)))).flat()
            ]);





            const localFileMap = new Map(localFiles.map(f => [f.hash, f]));
            const remoteFileMap = new Map(remoteFiles.map(f => [f.hash, f]));
            let skipped = 0;

            // Find files to upload (new or modified files)
            for (const [fileHash, localFile] of localFileMap) {
                const remoteFile = remoteFileMap.get(fileHash);

                if (!remoteFile) {
                    const fullPath = `${this.watchDir}/${localFile.path}`;
                    const content = await fs.readFile(fullPath);
                    let group = remoteGroups.find(x => x.name === localFolders.find(f => localFile.path.startsWith(f)))?.id;
                    if (!group) {
                        group = (await remoteService.addNewGroup(localFolders.find(f => localFile.path.startsWith(f))))?.groupId;
                    }

                    if (!group) {
                        throw new Error('Failed to add new group');
                    }
                    await remoteService.uploadFile(localFile.path, content, group);



                } else {
                    skipped++;

                }
            }

            console.log(`Skipped ${skipped} files`);

            // Find files to delete (files that exist remotely but not locally)
            for (const [filePath] of remoteFileMap) {
                if (!localFileMap.has(filePath)) {
                    const remoteFile = remoteFileMap.get(filePath);
                    await remoteService.deleteFile(remoteFile.hash);
                }
            }


            console.log('Sync completed');

        } catch (error) {
            console.error('Sync failed:', error);
        } finally {


            this.isSyncing = false;
        }
    }
}

// Initialize the application
const watchDir = process.env.WATCH_DIRECTORY;
if (!watchDir) {
    console.error('WATCH_DIRECTORY not set in .env');
    process.exit(1);
}

const syncManager = new SyncManager(watchDir);

// Set up file watcher
const watcher = chokidar.watch(watchDir, {
    ignored: /(^|[\/\\])\..*|\.meta$/, // ignore hidden files and files ending in .meta
    persistent: true
});

watcher
    .on('add', () => syncManager.sync())
    .on('change', () => syncManager.sync())
    .on('unlink', () => syncManager.sync());

// Set up webhook endpoint for pinata to call, but would need pinata to be authority on some files and it currently is not
// app.post('/webhook/sync', async (req, res) => {
//     try {
//         await syncManager.sync();
//         res.json({ success: true });
//     } catch (error) {
//         res.status(500).json({ success: false, error: error.message });
//     }
// });

// Start the server
const PORT = process.env.FILEPORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Watching directory: ${watchDir}`);
});


if (process.env.USECRON) {
    const cron = require('node-cron');

    // Schedule the sync to run every 30 seconds
    cron.schedule('*/30 * * * * *', () => {
        console.log('Running scheduled sync');
        syncManager.sync();
    });
}