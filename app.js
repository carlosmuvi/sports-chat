var express = require('express')
  , app = express()
  , http = require('http')
  , mongoose = require('mongoose')
  , bodyParser = require('body-parser')
  , server = http.createServer(app)
  , io = require('socket.io').listen(server);

server.listen(8080);

//define database Uri, routing to localhost if not found
var uristring =
process.env.MONGOLAB_URI ||
process.env.MONGOHQ_URL ||
'mongodb://localhost/sportsdb';

app.use(bodyParser.json())

// routing
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

/*
{
  "roomIds": [
    "Uno",
    "Dos",
    "tres"
  ],
  "lastMessageId": 1
}
*/

app.post('/lastmessages', function (req, res) {
	var roomIds = req.body.roomIds;
	var lastMessageId = req.body.lastMessageId;
	findlostMessages(roomIds, lastMessageId, function(data){
		res.send(data);
	})
});

// usernames which are currently connected to the chat
var usernames = {};

// rooms which are currently available in chat
var rooms = [];

io.sockets.on('connection', function (socket) {
	
	// when the client emits 'adduser', this listens and executes
	socket.on('adduser', function(username, room){
		// store the username in the socket session for this client
		socket.username = username;
		// store the room name in the socket session for this client
		socket.room = room;
		// add the client's username to the global list
		usernames[username] = username;
		// send client to selected room, creating it if not exists
		if(rooms.indexOf(room) < 0){
			rooms.push(room);
		}
		socket.join(room);
		// echo to client they've connected
		socket.emit('updatechat', 'SERVER', 'you have connected to ' + room);
		// echo to selected room that a person has connected to their room
		socket.broadcast.to(room).emit('updatechat', 'SERVER', username + ' has connected to this room');
		socket.emit('updaterooms', rooms, room);
	});
	
	// when the client emits 'sendchat', this listens and executes
	socket.on('sendchat', function (data) {
		// we tell the client to execute 'updatechat' with 2 parameters
		io.sockets.in(socket.room).emit('updatechat', socket.username, data);
		insertMessage(socket.room, socket.username, data)
	});
	
	socket.on('switchRoom', function(newroom){
		socket.leave(socket.room);
		socket.join(newroom);
		socket.emit('updatechat', 'SERVER', 'you have connected to '+ newroom);
		// sent message to OLD room
		socket.broadcast.to(socket.room).emit('updatechat', 'SERVER', socket.username+' has left this room');
		// update socket session room title
		socket.room = newroom;
		socket.broadcast.to(newroom).emit('updatechat', 'SERVER', socket.username+' has joined this room');
		socket.emit('updaterooms', rooms, newroom);
	});
	
	// when the user disconnects.. perform this
	socket.on('disconnect', function(){
		// remove the username from global usernames list
		delete usernames[socket.username];
		// update list of users in chat, client-side
		io.sockets.emit('updateusers', usernames);
		// echo globally that this client has left
		socket.broadcast.emit('updatechat', 'SERVER', socket.username + ' has disconnected');
		socket.leave(socket.room);
	});
});

/** STORAGE **/

//Connect to MongoDb
mongoose.connect(uristring, function (err, res) {
	if (err) {
		console.log ('ERROR connecting to: ' + uristring + '. ' + err);
	} else {
		console.log ('Succeeded connected to: ' + uristring);
		loadRooms();
	}
});

// message schema
var messageSchema = new mongoose.Schema({
	messageId: Number,
	messageContent: String,
	messageUserName: String,
	roomId: String
});

var counterSchema = new mongoose.Schema({
	seq: Number,
	_id: String
});

var Message = mongoose.model('messages', messageSchema);
var Counter = mongoose.model('counters', counterSchema);

function loadRooms(){
	Message.distinct('roomId', function(err, data){
		if(err){
			console.log ('Error retrieving rooms!')		
		}else{
			console.log ('Success retrieving rooms!' + data)
			rooms = data;
		}
	});
}

function findlostMessages(roomIds, lastRcvMessageId, callback){
	Message.find(
		{ "messageId": { $gt: lastRcvMessageId }, "roomId": { $in: roomIds }},
		'messageId messageContent messageUserName roomId',
		function (err, docs) {
			if (err){
				console.log ('Error finding lost messages!' + err);	
			}else{
				console.log ('Success finding lost messages!' + docs);
				callback(docs);	
			} 
		}
	);
}

function insertMessage(roomId, messageUserName, messageContent){
	//creates autoincrement ID  
	Counter.findOneAndUpdate(
	    {_id: "counterSequence"},
	    {$inc:{seq:1}},
	    {upsert: true, new:true},
	    function(err, data) {
			if(err){
				console.log ('Error getting counter!' + err);		
			}else{
				console.log ('Success getting counter!' + data.seq);		
				// store sent message into db
				var currentMessage = new Message ({
				  messageId: data.seq, 
				  messageContent: messageContent, 
				  messageUserName: messageUserName,
				  roomId: roomId 
				});
				currentMessage.save(function (err){
					if (err){
						console.log ('Error on save!')	
					}else{
						console.log ('Success on save!')	
					} 
				});
			}
	    }
	); 	
}
 
