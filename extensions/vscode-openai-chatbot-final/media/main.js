/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const vscode = acquireVsCodeApi();

document.getElementById('send').addEventListener('click', () => {
  const text = document.getElementById('input').value.trim();
  const model = document.getElementById('model-select').value;

  if (!text) return;

  appendMessage(text, 'user');

  vscode.postMessage({
    command: 'send',
    text,
    model
  });

  document.getElementById('input').value = '';
});
document.getElementById("input").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    document.getElementById("send").click();
  }
});

document.getElementById('show-tools').addEventListener('click', () => {
  vscode.postMessage({ command: 'showToolsInCommandPalette' });
});

window.addEventListener('message', event => {
  const message = event.data;

  if (message.command === 'response') {
    appendMessage(message.text, 'ai');
  }

  if (message.command === 'loadTools') {
    const toolsList = message.tools;
    const listElement = document.getElementById('tools-list');
    listElement.innerHTML = toolsList.map(tool => `<li>${tool}</li>`).join('');
  }
});

function appendMessage(text, sender) {
  const messagesDiv = document.getElementById('messages');
  const msgWrapper = document.createElement('div');
  msgWrapper.className = 'message ' + (sender === 'user' ? 'user-msg' : 'ai-msg');

  const bubble = document.createElement('div');
  bubble.className = 'message-box';
  bubble.innerText = text;

  msgWrapper.appendChild(bubble);
  messagesDiv.appendChild(msgWrapper);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
