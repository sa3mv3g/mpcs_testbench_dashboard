const https = require('https');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'build');
if (!fs.existsSync(dir)){
    fs.mkdirSync(dir);
}

const file = fs.createWriteStream(path.join(dir, 'icon.ico'));
https.get("https://raw.githubusercontent.com/electron/electron/main/default_app/icon.ico", function(response) {
  response.pipe(file);
});
