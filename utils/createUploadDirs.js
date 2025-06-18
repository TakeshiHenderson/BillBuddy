const fs = require('fs');
const path = require('path');

const createUploadDirectories = () => {
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const groupPhotosDir = path.join(uploadsDir, 'group-photos');
    const profilePhotosDir = path.join(uploadsDir, 'profile-photos');

    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir);
    }

    if (!fs.existsSync(groupPhotosDir)) {
        fs.mkdirSync(groupPhotosDir);
    }

    if (!fs.existsSync(profilePhotosDir)) {
        fs.mkdirSync(profilePhotosDir);
    }
};

module.exports = createUploadDirectories; 