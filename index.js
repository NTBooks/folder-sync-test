require('dotenv').config();
const express = require('express');
const chokidar = require('chokidar');
const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const Hash = require('ipfs-only-hash');

const app = express();
app.use(express.json());

if (!process.env.PINATA_JWT || !process.env.WATCH_DIRECTORY) {
    console.error('Missing required environment variables: PINATA_JWT, WATCH_DIRECTORY');
    process.exit(1);
}

const delay = async (seconds) => {
    for (let i = seconds; i > 0; i--) {
        console.log(`Retrying in ${i} second(s)...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
};

const fetchWithRetry = async (url, options, retries = 3) => {
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
};

const remoteService = {
    async listFolder(rootGroup) {
        let allFiles = [];
        let pageOffset = 0;
        const pageLimit = 1000;
        let hasMoreFiles = true;

        while (hasMoreFiles) {
            const response = await fetchWithRetry(`https://api.pinata.cloud/data/pinList?${rootGroup ? `groupId=${rootGroup}&` : ''}status=pinned&pageLimit=${pageLimit}&pageOffset=${pageOffset}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${process.env.PINATA_JWT}`
                }
            });
            const data = await response.json();
            allFiles = allFiles.concat(data.rows);
            pageOffset += pageLimit;
            hasMoreFiles = data.rows.length === pageLimit;
        }

        return allFiles.filter(file => file.metadata.keyvalues?.localfolder)
            .map(file => ({
                path: file.metadata.name,
                hash: file.ipfs_pin_hash
            }));
    },

    async uploadFile(filePath, content, group) {
        console.log('Uploading file:', filePath);
        const fileName = path.basename(filePath);
        const formData = new FormData();
        formData.append('file', new Blob([content]), fileName);

        const pinataOptions = { cidVersion: 0 };
        if (group) {
            pinataOptions.groupId = group;
        }
        formData.append('pinataOptions', JSON.stringify(pinataOptions));

        // special case for meta enabled files
        // check if fileName is a CIDv0

        //fileName.replace('.bin', '').match(/^[a-zA-Z0-9]{56}$/)
        const metaPath = filePath.endsWith('.bin') ? path.join(process.env.WATCH_DIRECTORY, filePath.replace('.bin', '.meta')) : null;
        if (metaPath && fsSync.existsSync(metaPath)) {
            const meta = await fs.readFile(metaPath, 'utf8');
            const metaJson = JSON.parse(meta);
            formData.append('pinataMetadata', JSON.stringify({
                name: metaJson.name,
                keyvalues: {

                    ...metaJson.keyvalues,
                    localfolder: process.env.WATCH_DIRECTORY,
                    localfile: filePath,
                    name: fileName
                }
            }));
        } else {


            formData.append('pinataMetadata', JSON.stringify({
                name: fileName,
                keyvalues: {
                    localfolder: process.env.WATCH_DIRECTORY,
                    localfile: filePath,
                    name: fileName
                }
            }));
        }
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
            const data = await response.json();
            console.log(data.error?.details || data.message);
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
            body: JSON.stringify({ name: groupName })
        });

        if (!response.ok) {
            const data = await response.json();
            return { success: false, message: data.message };
        }

        const data = await response.json();
        return { success: true, groupId: data.id };
    }
};

const calculateFileHash = async (filePath) => {
    const fileContent = await fs.readFile(filePath);
    return await Hash.of(fileContent);
};

const getRemoteGroups = async () => {
    const groups = await remoteService.listRemoteGroups();
    return groups.groups.map(group => ({ name: group.name, id: group.id }));
};

const getLocalFiles = async (watchDir) => {
    const files = [];

    const readDir = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(watchDir, fullPath);

            if (entry.isDirectory()) {
                await readDir(fullPath);
            } else {
                const hash = await calculateFileHash(fullPath);
                files.push({ path: relativePath, hash });
            }
        }
    };

    await readDir(watchDir);
    return files.filter(f => !f.path.endsWith('.meta'));
};

const getLocalFolders = async (watchDir) => {
    const files = await getLocalFiles(watchDir);
    return [...new Set(files.filter(f => f.path.includes(path.sep)).map(f => f.path.split(path.sep)[0]))];
};

const sync = async (watchDir) => {
    if (sync.isSyncing) {
        return;
    }

    try {
        sync.isSyncing = true;
        console.log('Starting sync...');

        let remoteGroups = await getRemoteGroups();

        if (process.env.MANAGED_GROUPS) {
            const managedGroups = process.env.MANAGED_GROUPS.split(',');
            remoteGroups = remoteGroups.filter(g => managedGroups.includes(g.name));
        } else {
            remoteGroups = [{ name: 'root', id: null }];
        }

        const localFolders = await getLocalFolders(watchDir);

        let [localFiles, remoteFiles] = await Promise.all([
            getLocalFiles(watchDir),
            (await Promise.all(remoteGroups.map(group => remoteService.listFolder(group.id)))).flat()
        ]);

        localFiles = localFiles.filter(f => process.env.MANAGED_GROUPS ? process.env.MANAGED_GROUPS.split(',').some(g => f.path.startsWith(g)) : true);

        const localFileMap = new Map(localFiles.map(f => [f.hash, f]));
        const remoteFileMap = new Map(remoteFiles.map(f => [f.hash, f]));
        let skipped = 0;

        for (const [fileHash, localFile] of localFileMap) {
            const remoteFile = remoteFileMap.get(fileHash);

            if (!remoteFile) {
                const fullPath = path.join(watchDir, localFile.path);
                const content = await fs.readFile(fullPath);
                let group = remoteGroups.find(x => x.name === localFolders.find(f => localFile.path.startsWith(f)))?.id;
                if (!group && localFolders.length > 0) {
                    group = (await remoteService.addNewGroup(localFolders.find(f => localFile.path.startsWith(f))))?.groupId;
                }
                await remoteService.uploadFile(localFile.path, content, group);
            } else {
                skipped++;
            }
        }

        console.log(`Skipped ${skipped} files`);

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
        sync.isSyncing = false;
    }
};

const watchDir = process.env.WATCH_DIRECTORY;
if (!watchDir) {
    console.error('WATCH_DIRECTORY not set in .env');
    process.exit(1);
}

sync.isSyncing = false;

const watcher = chokidar.watch(watchDir, {
    ignored: /(^|[\/\\])\..*|\.meta$/, // ignore hidden files and files ending in .meta
    persistent: true
});

watcher
    .on('add', () => sync(watchDir))
    .on('change', () => sync(watchDir))
    .on('unlink', () => sync(watchDir));

const PORT = process.env.FILEPORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Watching directory: ${watchDir}`);
});

if (process.env.USECRON) {
    const cron = require('node-cron');
    cron.schedule('*/30 * * * * *', () => {
        console.log('Running scheduled sync');
        sync(watchDir);
    });
}