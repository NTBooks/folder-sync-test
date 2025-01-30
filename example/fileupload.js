const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.set('view engine', 'ejs');

const WATCH_DIRECTORY = process.env.WATCH_DIRECTORY;

const readDirRecursive = async (dir) => {
    let results = [];
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const file of list) {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
            results = results.concat(await readDirRecursive(filePath));
        } else {
            results.push(filePath);
        }
    }
    return results;
};

app.get('/', async (req, res) => {
    try {

        let files = [];

        if (process.env.MANAGED_GROUPS) {
            const managedGroups = process.env.MANAGED_GROUPS.split(',');
            for (const group of managedGroups) {


                let groupFiles = await readDirRecursive(path.join(WATCH_DIRECTORY, group));
                groupFiles = groupFiles.filter(file => !file.endsWith('.meta')).map(file => file.replace(WATCH_DIRECTORY, ''));
                files.push(...groupFiles);
            }
        } else {
            files = await fs.readdir(WATCH_DIRECTORY);
        }

        res.send(
            `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Rediculously Simple IPFS Uploader</title>
        </head>
        <body>
            <h1>Rediculously Simple IPFS Uploader</h1>
            <h2>File List</h2>
            <ul>
                ${files.map(file => `
                    <li style="margin: 10px;">
                        <form action="/delete/?filename=${encodeURIComponent(file)}" method="post" style="display:inline;">
                            <button type="submit" style="color: red; background-color: #ffcccc; border: 1px solid red;">

                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash-2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6l-2 14H7L5 6"></path>
                                    <path d="M10 11v6"></path>
                                    <path d="M14 11v6"></path>
                                    <path d="M5 6l1-3h12l1 3"></path>
                                </svg>
                                Delete
                            </button>
                        </form>
                        ${file}
                    </li>
                `).join('')}
            </ul>
            <div style="border: 1px solid #ccc; border-radius: 10px; padding: 20px;">
                <form action="/upload" method="post" enctype="multipart/form-data">
                    <input type="file" name="file">
                    <button type="submit">Upload</button>
                </form>
            </div>
        </body>
        </html>


    `)

    } catch (err) {
        console.error('Error reading directory:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const tempPath = req.file.path;

        // NOTE: if using managed files these get uploaded to the root and won't show in the list
        const targetPath = path.join(WATCH_DIRECTORY, req.file.originalname);
        await fs.rename(tempPath, targetPath);
        res.redirect('/');
    } catch (err) {
        console.error('Error saving file:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/delete', async (req, res) => {

    // PITFALL: THIS IS NOT SAFE, IT CAN DELETE ANY FILE
    const filePath = path.join(WATCH_DIRECTORY, req.query.filename);

    try {
        await fs.unlink(filePath);
        res.redirect('/');
    } catch (err) {
        console.error('Error deleting file:', err);
        res.status(500).send('Internal Server Error');
    }
});

const PORT = process.env.DEMOPORT || 3001;
app.listen(PORT, () => {
    console.log('Demo server running at http://127.0.0.1:' + PORT);
});
