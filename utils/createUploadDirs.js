const fs = require('fs');
const path = require('path');

// Create upload directories if they don't exist
const createUploadDirectories = () => {
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const groupPhotosDir = path.join(uploadsDir, 'group-photos');
    const profilePhotosDir = path.join(uploadsDir, 'profile-photos');

    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir);
    }

    // Create group-photos directory if it doesn't exist
    if (!fs.existsSync(groupPhotosDir)) {
        fs.mkdirSync(groupPhotosDir);
    }

    // Create profile-photos directory if it doesn't exist
    if (!fs.existsSync(profilePhotosDir)) {
        fs.mkdirSync(profilePhotosDir);
    }
};

module.exports = createUploadDirectories; 