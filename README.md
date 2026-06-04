# File Access Portal

React + Express + MongoDB app for uploading files, downloading files, and sharing file access by user email.

## What It Does

- Users register and login with email/password.
- Uploaded files belong to the logged-in user.
- A user can always see and download their own files.
- File owners can share access with another user's email address.
- Shared users can see and download only the files shared with them.
- The first registered account becomes `admin`.

## Local Setup

Start MongoDB first, then run:

```bash
npm install
npm run dev
```

The default MongoDB connection is:

```text
mongodb://127.0.0.1:27017/fileupload
```

## Production

```bash
npm install
npm run build
MONGO_URI=mongodb://127.0.0.1:27017/fileupload \
JWT_SECRET=replace-with-a-long-random-secret \
UPLOAD_DIR=/var/www/fileupload/uploads \
PORT=3000 \
npm start
```

## Environment Variables

- `PORT`: server port, defaults to `3000`
- `MONGO_URI`: MongoDB connection string, defaults to `mongodb://127.0.0.1:27017/fileupload`
- `JWT_SECRET`: secret used to sign login sessions. Set this in production.
- `COOKIE_SECURE`: set to `true` only when serving the app over HTTPS.
- `UPLOAD_DIR`: directory where uploaded files are saved, defaults to `./uploads`
- `MAX_FILE_SIZE_BYTES`: optional upload size limit in bytes. Leave unset for no application-level limit.

## Nginx Notes

For very large uploads, make sure Nginx allows large request bodies and long-running requests:

```nginx
client_max_body_size 10G;
proxy_request_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```
