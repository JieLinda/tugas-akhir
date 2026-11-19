# Test PDFs Directory

This directory is used for testing the job profile sync feature when SharePoint is unavailable or during development.

## Setup for Local Testing

1. **Enable Local PDF Mode:**
   - Uncomment `LOCAL_PDF_FOLDER=./test-pdfs` in `.env`
   - The sync service will use this folder instead of SharePoint

2. **Directory Structure:**
   ```
   test-pdfs/
   ├── tenant-1/          ← Tenant name
   │   ├── profile1.pdf
   │   └── profile2.pdf
   ├── tenant-2/
   │   └── profile3.pdf
   ```

3. **Add Sample PDFs:**
   - Place PDF files in tenant subdirectories
   - File names should be descriptive (e.g., `manager_role.pdf`)

4. **Run Sync:**
   ```bash
   npm run cli -- job-profiles
   ```

## SharePoint Production Setup

For production with SharePoint Online, you need OAuth authentication:

### Option 1: Azure AD App Registration (Recommended)
1. Register an app in Azure AD
2. Grant SharePoint API permissions
3. Use Client Credentials flow with the sync service

### Option 2: Account with Proper Permissions
1. Ensure the service account has:
   - Owner or Edit permissions on the SharePoint site
   - Permission to access the Job Profile folder
2. Note: SharePoint Online no longer supports Basic Auth by default

### Environment Variables for SharePoint:
```env
SP_SITE_URL=https://[tenant].sharepoint.com/sites/[site]
SP_USERNAME=user@domain.com
SP_PASSWORD=password
SP_JOB_PROFILE_FOLDER=path/to/folder
```

## Testing Workflow

1. Start with **Local PDFs** to validate:
   - PDF extraction works
   - LLM processing is functional
   - Database storage is correct

2. Once working, configure **SharePoint** with proper Azure AD auth

3. Switch back to SharePoint in production

## Troubleshooting

### "Failed to parse PDF"
- Ensure file is a valid PDF
- Check that pdf-parse can handle the format

### "LLM extraction failed"
- Verify LLM_BASE_URL and LLM_API_KEY are correct
- Check LLM service is accessible

### "Database error"
- Verify PostgreSQL connection string
- Check sync_job_profiles table exists: `npm run cli -- db-check`
