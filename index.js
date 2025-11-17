const express = require('express');
const cors = require('cors');
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const port = process.env.PORT || 3000

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);
// console.log(decoded);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


// Middleware
app.use(cors())
app.use(express.json())


const verifyFireBaseToken = async (req, res, next) => {

    if (!req.headers.authorization) {
        return res.status(401).send({ message: 'Unauthorized Access' })
    }
    const token = req.headers.authorization.split(' ')[1]
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized Access' })
    }
    try {
        const userInfo = await admin.auth().verifyIdToken(token)
        req.token_email = userInfo.email
        // console.log('Here', userInfo);
        next()
    }
    catch {
        return res.status(401).send({ message: 'Unauthorized Access' })
    }
}

const uri = process.env.MONGODB_URI;

// MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

app.get('/', (req, res) => {
    res.send("Better Tomorrow server is running")
})

async function run() {
    try {
        // await client.connect()

        const db = client.db("better_tomorrow_DB")
        const eventsCollection = db.collection("events")
        const usersCollection = db.collection("users")
        const joinedCollection = db.collection("joined")

        // API

        app.post('/events', verifyFireBaseToken, async (req, res) => {
            console.log(req.headers);
            const newEvent = req.body
            const result = await eventsCollection.insertOne(newEvent)
            res.send(result)
        })

        app.get('/events', async (req, res) => {
            const email = req.query.email
            const query = {}
            if (email) {
                query.creatorEmail = email
            }
            const cursor = eventsCollection.find(query).sort({ eventDate: 1 })
            const result = await cursor.toArray()
            res.send(result)
        })

        app.patch('/events/:id', verifyFireBaseToken, async (req, res) => {
            const id = req.params.id
            const updateEvent = req.body


            try {
                const updateFields = {}

                if (updateEvent.title) updateFields.title = updateEvent.title
                if (updateEvent.description) updateFields.description = updateEvent.description
                if (updateEvent.eventType) updateFields.eventType = updateEvent.eventType
                if (updateEvent.thumbnailUrl) updateFields.thumbnailUrl = updateEvent.thumbnailUrl
                if (updateEvent.location) updateFields.location = updateEvent.location
                if (updateEvent.eventDate) updateFields.eventDate = updateEvent.eventDate
                updateFields.updatedAt = new Date()

                const query = { _id: new ObjectId(id) }

                const update = { $set: updateFields }
                const result = await eventsCollection.updateOne(query, update)

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Event not found or no changes made", modifiedCount: 0 })
                }

                res.send({ message: "Event updated successfully", modifiedCount: result.modifiedCount })
            }
            catch (error) {
                console.error(error);
                res.status(500).send({ message: "Server error", error })
            }
        })

        app.delete('/events/:id', verifyFireBaseToken, async (req, res) => {
            const id = req.params.id
            // const userEmail = req.body.email

            try {
                const query = { _id: new ObjectId(id) }
                const result = await eventsCollection.deleteOne(query)

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Event not found", deletedCount: 0 })
                }
                res.send({ message: "Event deleted successfully", deletedCount: result.deletedCount })
            } catch {
                console.error("DELETE/events /:id", error);
                res.status(500).send({ message: "Server error", error: error.message })
            }
        })

        app.get('/events/upcoming', async (req, res) => {

            const { eventType, search } = req.query

            // Upcoming events
            const query = {
                eventDate: { $gte: new Date().toISOString() }
            }
            // Filter by Event Type
            if (eventType && eventType !== "All") {
                query.eventType = eventType
            }
            // Search by Title 
            if (search) {
                query.title = { $regex: search, $options: "i" }
            }

            const cursor = eventsCollection.find(query).sort({ eventDate: 1 })
            const result = await cursor.toArray()
            res.send(result)
        })

        app.get('/events/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await eventsCollection.findOne(query)
            res.send(result)
        })



        app.post('/joined', verifyFireBaseToken, async (req, res) => {
            const joinEventData = req.body

            if (!joinEventData.userEmail || !joinEventData.eventId) {
                return res.status(400).send({ message: "Missing user or event information" })
            }
            const query = {
                userEmail: joinEventData.userEmail,
                eventId: joinEventData.eventId
            }

            const alreadyJoined = await joinedCollection.findOne(query)

            if (alreadyJoined) {
                console.log(alreadyJoined);
                return res.status(409).send({ message: 'You have already joined this event' })
            }

            const newJoin = {
                ...joinEventData,
                joinedAt: new Date()
            }

            result = await joinedCollection.insertOne(newJoin)

            res.send(result)
        })

        app.get('/joined', async (req, res) => {
            const email = req.query.email
            const query = {}
            if (email) {
                query.userEmail = email
            }
            const cursor = joinedCollection.find(query)
            const result = await cursor.toArray()
            res.status(200).send(result)
        })

        app.get('/joined-events', verifyFireBaseToken, async (req, res) => {
            const email = req.query.email

            const joinedEvents = await joinedCollection.find({ userEmail: email }).toArray()

            if (!joinedEvents.length) return res.json([])

            const eventIds = joinedEvents.map(event => new ObjectId(event.eventId))

            const matchedEvents = await eventsCollection.find({ _id: { $in: eventIds } }).sort({ eventDate: 1 }).toArray()

            res.send(matchedEvents)
        })

        app.get('/myevents', verifyFireBaseToken, async (req, res) => {
            const email = req.query.email
            const query = {}
            if (email) {
                query.creatorEmail = email
                if (email !== req.token_email) {
                    return res.status(403).send({ message: 'Forbidden access' })
                }
            }
            const cursor = eventsCollection.find(query).sort({ eventDate: 1 })
            const result = await cursor.toArray()
            res.send(result)
        })

        app.get('/users', async (req, res) => {
            const cursor = usersCollection.find()
            const result = await cursor.toArray()
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const newUser = req.body
            const email = req.body.email
            const query = { email: email }
            const existingUser = await usersCollection.findOne(query)
            if (existingUser) {
                res.send({ message: "User already exist" })
            }
            else {
                const result = await usersCollection.insertOne(newUser)
                res.send(result)
            }
        })

        // Send Ping to confirm connection
        // await client.db("admin").command({ ping: 1 })
        // console.log("Pinged you deployment. Connected to MongoDB");
    }
    finally {

    }
}

run().catch(console.dir)

app.listen(port, () => {
    console.log(`Better Tomorrow server is running on port: ${port}`);
})
