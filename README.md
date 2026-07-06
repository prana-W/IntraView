# IntraView

**⚠️ Note: The entire project is vibe-coded, so the code might not be polished or of the best quality as of now.**

IntraView is an interview preparation tool designed to help you record, transcribe, and review your interviews. It consists of a browser extension for capturing audio, a local server that uses an AI model for high-quality speech-to-text transcription, and a frontend interface to analyze and playback your transcripts. 

## How it Works
When you are on LeetCode during a problem, an IntraView button will appear. You can click on this button to start recording your audio. The extension sends the recorded audio to the local server for transcription. After you stop the recording, you can navigate to the local frontend (at `http://localhost:6767`) to view the transcription, listen to the audio playback, and easily copy a prompt to add to an AI for further analysis.

## Setup Instructions

Follow these steps to get IntraView up and running on your machine:

### 1. Clone the Repository
Clone the IntraView repository to your local machine and navigate into the project directory:
```bash
git clone <repository-url>
cd IntraView
```

### 2. Install the Browser Extension
1. Open your Chromium-based browser (Chrome, Edge, Brave, etc.) and go to the extensions page (e.g., `chrome://extensions`).
2. Turn on **Developer mode** (usually a toggle in the top right corner).
3. Click on **Load unpacked**.
4. Select the `extension` folder inside the cloned IntraView repository.

### 3. Install Dependencies
You need to install the Node.js dependencies for both the server and the frontend. Open a terminal and run:
```bash
# Install server dependencies
cd server
npm i

# Install frontend dependencies
cd ../frontend
npm i
```

### 4. Install PM2 Globally
We use PM2 to manage and keep our background services running. Install it globally:
```bash
npm i -g pm2
```

### 5. Start the Services
Go back to the root of the IntraView project and start the ecosystem using PM2:
```bash
cd ..
pm2 start ecosystem.config.js
```

**⏳ Important:** After starting the ecosystem, **wait for at least 10 minutes**. The server needs this time to download the transcription model locally on the first run.

### 6. Auto-Start on Boot
To ensure that IntraView automatically starts up whenever your computer reboots, run the following command to generate a startup script:
```bash
pm2 startup
```
*Note: PM2 will output a specific command that you need to copy and paste into your terminal to configure the startup system.*

Once you have run the generated startup command, save the current PM2 process list so it remembers to start IntraView:
```bash
pm2 save
```

You are now ready to use IntraView!
