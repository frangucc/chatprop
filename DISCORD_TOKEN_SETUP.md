# Discord Token Setup

## How to Get Your Discord Token

1. **Open Discord in Browser**
   - Go to https://discord.com/app
   - Log in to your account

2. **Open Developer Tools**
   - Press `F12` or `Cmd+Option+I` (Mac)
   - Go to the "Network" tab

3. **Get Your Token**
   - Type anything in any channel
   - Look for a request to `messages` 
   - Click on it and find "Request Headers"
   - Look for `authorization: YOUR_TOKEN_HERE`
   - Copy the token value

4. **Store Token Securely**
   ```bash
   # Create token file (one time)
   echo "YOUR_DISCORD_TOKEN" > /Users/franckjones/chatprop/.discord-token
   chmod 600 /Users/franckjones/chatprop/.discord-token
   ```

## Security Warning ⚠️
- **NEVER** share your Discord token
- **NEVER** commit it to git
- **NEVER** paste it in public
- Token gives full access to your account!

## Ready to Export?
Once you've saved your token, run:
```bash
cd /Users/franckjones/chatprop
./export-8-14.sh
```
