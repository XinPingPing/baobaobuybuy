/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');

var app = express();

app.set('port', process.env.PORT || 5000);
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Use your own validation token. Check that the token used in the Webhook 
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }
});

app.get('/test', function(req, res) {
    
    console.log("test query", req.query.sent);
    var flaskBackend = 'http://oxy-oxygen-0a52c618.corp.sg3.yahoo.com:5000/trigger/'+encodeURIComponent(req.query.sent);

    request.get(flaskBackend, function(error, response, body) {
        console.log("test body", body);
        // parse JSON string to object
        // var recommendations = JSON.parse(body);
        var recommendations = [];
        /// ....
        res.status(200).send(JSON.parse(body));
    });

});

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/implementation#subscribe_app_pages
 *
 */
app.post('/webhook', function (req, res) {

  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've 
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference#auth
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the 
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger' 
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam, 
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}


/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#received_message
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
function receivedMessage(event) {

    var senderID = event.sender.id;
    var sender = event.sender;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    var messageText = message.text;
    var messageAttachments = message.attachments;
    var messageQuickReply = message.quick_reply;

    if(messageQuickReply && messageQuickReply.payload && senderID != 300405090306637){
        baobao(senderID, messageQuickReply.payload, timeOfMessage);
    }else if (messageText && senderID != 300405090306637) {
        baobao(senderID, messageText, timeOfMessage);
    } else if (messageAttachments && senderID != 300405090306637) {
        // gulis(senderID, messageAttachments, 'attachments');
    } else{
        // TODO
    }
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference#message_delivery
 *
 */
function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
        messageIDs.forEach(function(messageID) {
                console.log("Received delivery confirmation for message ID: %s", 
                    messageID);
                });
    }

    console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. Read
 * more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#postback
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback 
    // button for Structured Messages.
    var payload = event.postback.payload;

    console.log("Received postback for user %d and page %d with payload '%s' " + 
            "at %d", senderID, recipientID, payload, timeOfPostback);
    console.log("Get Message >>>", payload.substring(1));

    // When a postback is called, we'll send a message back to the sender to 
    // let them know it was successful
    // var msg = msgs[Math.floor(Math.random() * msgs.length)];

    // sendTextMessage(senderID, '已加入 ' + payload + '，' + msg);
    baobao(senderID, payload.substring(1).replace(/ /g, ""), timeOfPostback);

}

function baobao(recipientId, messageText, timeOfMessage) {
    //var flaskBackend = 'http://oxy-oxygen-0a52c618.corp.sg3.yahoo.com:5000/trigger/' + rmessage
    
    console.log(messageText, timeOfMessage);
    var rmessage = recipientId + '_' + timeOfMessage + '_' + encodeURIComponent(messageText);
    console.log(rmessage);
    // var flaskBackend = 'http://linux2.csie.ntu.edu.tw:5000/trigger/' + rmessage; 
    var flaskBackend = 'http://linux2.csie.ntu.edu.tw:5000/trigger/' + rmessage; 
    request.get(flaskBackend, function(error, response, body) {
        console.log("baobao body >>>>", body);
        if (typeof (body) == 'undefined' || body === null){
            baobao_useless(recipientId, response);
        }else{
            var recommendations = JSON.parse(body);
            if ( recommendations.type == 'greeting'){
                baobao_greeting(recipientId);
            }else if (recommendations.type == 'carousel'){
                ToCarousel(recipientId, recommendations.data, encodeURIComponent(messageText));
            }else if (recommendations.type == 'kg'){
                ToKG(recipientId, recommendations.data);
            }else if (recommendations.type == 'recommendtype'){
                ToRecType(recipientId, recommendations.data);
            }else if (recommendations.type == 'text'){
                baobao_ask(recipientId, recommendations.data);
            }else{
                baobao_useless(recipientId);
            }
        }
    });
}

function baobao_greeting(recipientId){
    
    var response = {
        recipient: { id: recipientId},
        message: {
            "text": '想找什麼嗎？ 我可以幫你找手機或桌遊喔！',
            "quick_replies":[{
                "content_type":"text",
                "title":"桌遊",
                "payload": "PICKBOARDGAME"
            },{
                "content_type":"text",
                "title":"手機",
                "payload": "PICKCELLPHONE"
            },{
                "content_type":"text",
                "title": "都不要",
                "payload": "DONOTHING"
            }]}
    };
    console.log("baobao baobao_greeting >>>", response);
    callSendAPI(response);
}

function baobao_useless(recipientId){

    var num = Math.floor((Math.random() * 7));
    var textset = ["寶寶沒用 寶寶不說", 
                    "寶寶廢 寶寶找不到",
                    "為何又讓寶寶傷心又難過",
                    "果粉會告訴你100個你用不到的功能",
                    "戀愛惹",
                    "假的  眼睛業障重",
                    "寶寶已讀 但寶寶不回"]

    var response = {
        recipient: { id: recipientId},
        message: {"text": textset[num]}
    };
    console.log("baobao baobao_useless >>>", response);
    callSendAPI(response);
}

function baobao_ask(recipientId, askmessage){

    var response = {
        recipient: { id: recipientId},
        message: {"text": askmessage}
    };
    console.log("baobao baobao_ask >>>", response);
    callSendAPI(response);
}

function ToCarousel(recipientId, recommendations, messageText){

    var num = Math.floor((Math.random() * 5));
    var textset = [ "我想你可能會喜歡",
                    "根據你的回答，我推薦了這些",
                    "這些如何呀",
                    "拿去啦 自己不會找嗎",
                    "這些其實是寶寶喜歡的"]
    
    var response1 = {
        recipient: { id: recipientId},
        message: {"text": textset[num]}
    };
    console.log("Carousel content 1 >>>", response1);
 
    var response2 = {
        recipient: { id: recipientId},
        message: { attachment: {
            type: "template",
            payload: {
                template_type: "generic",
                elements: []}
        }}};
    console.log("Carousel content 2 >>>", response2);
    response2.message.attachment.payload.elements = recommendations;
    
    var response3 = {
        recipient: { id: recipientId},
        message: { attachment: {
            type: "template",
            payload: {
                template_type: "generic",
                elements: [{"title": '看更多', 
                            "buttons": [{"type": "web_url", "url": "https://tw.search.yahoo.com/search?p=" + messageText, "title": "看更多"}]
                            }]}
        }}};
    console.log("Carousel content 3 >>>", response3);
    
    callSendAPI(response1, [response2, response3]);
}

function AddMore(recipientId, response){
    
    if (response.length > 1){
        callSendAPI(response[0], response.slice(1));
    }else if (response.length == 1){
        callSendAPI(response[0]);
    }
}

function ToKG(recipientId, recommendations){

    var response = {
        recipient :{ id: recipientId },
        message: { attachment: {
            type: "template",
            payload: {
                template_type: "generic",
                elements: []}        
        }}};
    response.message.attachment.payload.elements = recommendations;
    console.log("baobao KG content >>>", response);

    var response_text = {
        recipient: { id: recipientId},
        message: {"text": "這是這個商品的基本資訊，點看更多有更完整的介紹喔～"}
    };

    callSendAPI(response_text, [response]);
}

function ToRecType(recipientId, recommendations){
    
    var response = {
        recipient :{ id: recipientId },
        message: { attachment: {
            type: "template",
            payload: {
                template_type: "generic",
                elements: []}        
        }}};
    response.message.attachment.payload.elements = recommendations;
    console.log("baobao recommend type >>>", response);
    callSendAPI(response);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */

function callSendAPI(messageData, moreResponse) {
    
    if (typeof(moreResponse) === 'undefined'){
        moreResponse = "";
    }

    request({
        uri: 'https://graph.facebook.com/v2.6/me/messages',
        qs: { access_token: PAGE_ACCESS_TOKEN },
        method: 'POST',
        json: messageData
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;
            console.log("Successfully sent generic message with id %s to recipient %s", messageId, recipientId);
            if (moreResponse != ''){
               AddMore(recipientId, moreResponse);
            }
        } else {
            console.error("Unable to send message.");
            //console.error(response);
            //console.error(error);
        }
    });  
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

