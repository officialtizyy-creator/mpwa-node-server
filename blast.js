const { dbQuery } = require('../database'),
  { formatReceipt, prepareMediaMessage, formatButtonMsg, Button } = require('../lib/helper'),
  { ulid } = require('ulid'),
  wa = require('../whatsapp'),
  fs = require('fs')

const inProgress = new Set()

const updateStatus = async (campaignId, receiver, status) => {
  await dbQuery(
    "UPDATE blasts SET status = '" +
      status +
      "' WHERE receiver = '" +
      receiver +
      "' AND campaign_id = '" +
      campaignId +
      "'"
  )
}

const checkBlast = async (campaignId, receiver) => {
  const result = await dbQuery(
    "SELECT status FROM blasts WHERE receiver = '" +
      receiver +
      "' AND campaign_id = '" +
      campaignId +
      "'"
  )
  return result.length > 0 && result[0].status === 'pending'
}

const sendBlastMessage = async (req, res) => {
  const parsedData = JSON.parse(req.body.data)
  const messageData = parsedData.data
  const campaignId = parsedData.campaign_id

  if (inProgress.has(campaignId)) {
    return res.send({ status: 'in_progress' })
  }

  inProgress.add(campaignId)
  res.send({ status: 'in_progress' })

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  
  const minDelay = Number(parsedData.delay) || 0;
  const maxDelay = Number(parsedData.delay_max) || 0;

  const sendMessages = async () => {
    try {
      for (let index = 0; index < messageData.length; index++) {
        const item = messageData[index]
        
		let delaySec = minDelay;
		if (maxDelay > minDelay) {
			delaySec = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
		}
		await delay(delaySec * 1000);

        if (!parsedData.sender || !item.receiver || !item.message) {
          continue
        }

        if (!await checkBlast(campaignId, item.receiver)) {
          continue
        }

        try {
          if (!await wa.isExist(parsedData.sender, formatReceipt(item.receiver))) {
            await updateStatus(campaignId, item.receiver, 'failed')
            continue
          }
        } catch {
          await updateStatus(campaignId, item.receiver, 'failed')
          continue
        }

        try {
          let sendResult

          if (parsedData.type === 'media') {
            const mediaMessage = JSON.parse(item.message)
            if (mediaMessage.caption && mediaMessage.caption.trim() !== '') {
              if (mediaMessage.footer && mediaMessage.footer.trim() !== '') {
                mediaMessage.caption = `${mediaMessage.caption}\n\n> _${mediaMessage.footer}_`
                delete mediaMessage.footer
              }
            } else if (mediaMessage.footer && mediaMessage.footer.trim() !== '') {
              mediaMessage.caption = `> _${mediaMessage.footer}_`
              delete mediaMessage.footer
            }
            sendResult = await wa.sendMedia(
              parsedData.sender,
              item.receiver,
              mediaMessage.type,
              mediaMessage.url,
              mediaMessage.caption,
              0,
              mediaMessage.viewonce,
              mediaMessage.filename
            )

          } else if (parsedData.type === 'sticker') {
            const stickerMessage = JSON.parse(item.message)
            sendResult = await wa.sendSticker(
              parsedData.sender,
              item.receiver,
              stickerMessage.type,
              stickerMessage.url,
              stickerMessage.filename
            )

          } else if (parsedData.type === 'button') {
            const buttonData = JSON.parse(item.message)
            const buttons = buttonData.buttons.map(buttonRawData => {
              const raw = buttonRawData.buttonText?.displayText || {}
              return {
                type: raw.type || 'reply',
                displayText: raw.displayText,
                id: buttonRawData.buttonId,
                phoneNumber: raw.phoneNumber,
                url: raw.url,
                copyCode: raw.copyCode
              }
            })
            sendResult = await wa.sendButtonMessage(
              parsedData.sender,
              item.receiver,
              buttons,
              buttonData.caption || buttonData.text || '',
              buttonData.footer,
              buttonData.image?.url
            )

          } else {
            const msg = JSON.parse(item.message)
            if (msg.text && msg.footer && msg.text.trim() !== '') {
              msg.text = wa.randomizeText(`${msg.text}\n\n> _${msg.footer}_`)
              delete msg.footer
            }
            sendResult = await wa.sendMessage(
              parsedData.sender,
              item.receiver,
              msg
            )
          }

          const status = sendResult ? 'success' : 'failed'
          await updateStatus(campaignId, item.receiver, status)

        } catch (sendError) {
          if (sendError.message.includes('503')) {
            await delay(5000)
            index--
          } else {
            await updateStatus(campaignId, item.receiver, 'failed')
          }
        }
      }
    } finally {
      inProgress.delete(campaignId)
    }
  }

  sendMessages().catch(() => {
    inProgress.delete(campaignId)
  })
}

module.exports = { sendBlastMessage }
