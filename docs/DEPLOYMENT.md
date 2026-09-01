# Deployment

Both services deploy automatically on push to `main`:

- **Backend** → Railway, root directory `backend/`
- **Frontend** → Vercel, root directory `frontend/`

No manual `railway up` / `vercel --prod` needed anymore — push to `main` and both redeploy.
