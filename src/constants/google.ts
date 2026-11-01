/**
 * The Google OAuth client of NoteRoot (type "Desktop app") and its endpoints. The client id and secret of a desktop
 * application are not secrets (Google says so: they are shipped with every copy of the program); what protects the
 * account is the consent of the user and the PKCE check of the sign-in. The client of the user (`GoogleClientStore`, a file in the extension storage) wins over these. Fill them in once, after creating the client in
 * the Google Cloud Console (see CLAUDE.md, Google Drive sync). While they are empty, the Google Drive sync says it is not set up.
 */
export const GoogleOAuth = {
  clientId: "",
  clientSecret: "",
  /** Only the files that NoteRoot made itself: not the rest of the Drive of the user, and no verification by Google needed. */
  scope: "https://www.googleapis.com/auth/drive.file",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
} as const;
