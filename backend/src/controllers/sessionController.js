import { MessageSearchSource } from "stream-chat"
import { chatClient, streamClient } from "../lib/stream.js"
import Session from "../models/Session.js"

export async function createSession(req, res) {
    try {
        const { problem, difficulty } = req.body
        const userId = req.user._id
        const clerkId = req.user.clerkID

        if (!problem || !difficulty) {
            return res.status(400).json({ message: "Problem and Difficulty are required" })
        }

        //generate a unique call id for stream video
        const callId = `session_${Date.now()}_${Math.random().toString(36).substrinng(7)}`

        //create the session in the database
        const session = await Session.create({ problem, difficulty, host: userId, callId })

        //create stream video call
        await streamClient.video.call("default", callId).getOrCreate({
            data: {
                created_by_id: clerkId,
                custom: { problem, difficulty, sessionId: session._id.toString() },
            },
        })

        //chat messaging

        chatClient.channel("messaging", callId, {
            name: `${problem} Session`,
            created_by_id: clerkID,
            members: [clerkID]
        })

        await channel.create()
        res.status(201).json({ session })
    } catch (error) {
        console.log("Error in createSession controller:", error.message)
        res.status(500).json({ message: "Internal Server Error" })
    }
}

export async function getActiveSessions(_, res) {
    try {
        const sessions = await Session.find({ status: "active" })
            .populate("host", "name profileImage email clerkID")
            .sort({ createdAt: -1 })
            .limit(20); //It fetches the latest 20 active sessions, sorted(descending order) by newest first, and replaces each session’s host ID with the host’s basic profile info.

        res.status(200).json({ sessions })

    } catch (error) {
        console.log("Error in getActiveSessions controller:", error.message)
        res.status(500).json({ message: "Internal Server Error" })
    }
}

export async function getMyRecentSessions(req, res) {
    try {
        const userId = req.user._id
        //get sessions where user is either host or participant
        const sessions = await Session.find({
            status: "completed",
            $or: [{ host: userId }, { participant: userId }]
        })
            .sort({ createdAt: -1 })
            .limit(20)

        res.status(200).json({ sessions })

    } catch (error) {
        console.log("Error in getMyRecentSessions controller:", error.message)
        res.status(500).json({ message: "Internal Server Error" })
    }
}

export async function getSessionById(req, res) {
    try {
        const { id } = req.params //destructure the value to get id

        const session = await Session.findById(id)
            .populate("host", "name email profileImage clerkID")
            .populate("participant", "name email profileImage clerkID")

        if (!session) return res.status(404).json({ message: "Session not found" })

        res.status(200).json({ session })
    } catch (error) {
        console.log("Error in getSessionById controller:", error.message)
        res.status(500).json({ message: "Internal Server Error" })
    }
}

export async function joinSession(req, res) {
    try {
        const { id } = req.params
        const userId = req.user._id
        const clerkID = req.user.clerkID

        const session = await Session.findById(id)

        if (!session) return res.status(404).json({ message: "Session not found" })

        //check if session is already full - has a participant
        if (session.participant) return res.status(404).json({ message: "Session is full" })

        session.participant = userId
        await session.save()

        const channel = chatClient.channel("messaging", session.callId)
        await channel.addMembers([clerkID])

        res.status(200).json({ session })

    } catch (error) {
        console.log("Error in joinSession controller:", error.message)
        res.status(500).json({ message: "Internal Server Error" })
    }
}

//use express-async-handler if code gets bigger instead of try catch everytime
export async function endSession(req, res) {
    try {
        const { id } = req.params
        const userId = req.user._id
        const session = await Session.findById(id)

        if (!session) return res.status(404).json({ message: "Session not found" })

        //check if user is the host
        if (session.host.toString() !== userId.toString()) {
            res.status(403).json({ message: "Only the host can end the Session" })
        }

        //check if session is already completed
        if (session.status === "completed") {
            return res.status(400).json({ message: "Session is already completed" })
        }

        session.status = "completed"
        await session.save()

        // delete stream video call
        const call = streamClient.video.call("default", session.callId)
        await call.delete({ hard: true })

        // delete stream chat channel
        const channel = chatClient.channel("messaging", session.callId)
        await channel.delete()

        res.status(200).json({ session, message: "Session ended successfully" })

    } catch (error) {
        console.log("Error in endSession controller:", error.message)
        res.status(500).json({ message: "Internal Server Error" })
    }
}


