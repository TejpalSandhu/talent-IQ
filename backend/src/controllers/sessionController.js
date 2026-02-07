import { MessageSearchSource } from "stream-chat"
import { chatClient, streamClient } from "../lib/stream.js"
import Session from "../models/Session.js"

/**
 * Create a new session, initialize a Stream video call and a chat channel, and persist the session.
 *
 * Expects req.body to include `problem` and `difficulty`, and req.user to include `_id` (host user id)
 * and `clerkID` (Stream/Chat user id). On success sends a 201 response with the created session.
 *
 * Side effects: creates a Session document in the database, creates or fetches a Stream video call
 * (using a generated callId), and creates a Stream chat channel for the session.
 *
 * @param {import('express').Request} req - Express request. Must have body: { problem, difficulty } and user: { _id, clerkID }.
 * @param {import('express').Response} res - Express response used to send HTTP status and JSON payloads.
 */
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

/**
 * Retrieve up to 20 most recent active sessions and respond with their host profiles.
 *
 * Queries sessions whose status is "active", populates each session's host with
 * basic profile fields (name, profileImage, email, clerkID), sorts results by
 * creation time descending, limits to 20 entries, and sends a JSON response
 * containing the sessions. Responds with HTTP 500 on internal errors.
 */
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

/**
 * Retrieve the current user's recent completed sessions where they were host or participant.
 *
 * Responds with status 200 and a JSON object { sessions } containing up to 20 sessions sorted by newest first on success;
 * responds with status 500 and an error message on failure.
 */
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

/**
 * Fetches a session by its ID and returns it in the HTTP response.
 *
 * If found, the session is returned with the host and participant populated
 * (fields: `name`, `email`, `profileImage`, `clerkID`). If no session exists
 * with the given ID, responds with 404. On unexpected errors, responds with 500.
 */
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

/**
 * Add the current user as the participant of an existing session and add their clerk ID to the session chat channel.
 *
 * Expects `req.params.id` (session ID) and `req.user` containing `_id` (user ID) and `clerkID` (chat member ID).
 *
 * @param {Object} req - Express request object with `params.id` and `user` described above.
 * @param {Object} res - Express response object used to send HTTP responses.
 * @returns {Object} HTTP response:
 *  - `200` with `{ session }` when the user successfully joins.
 *  - `404` when the session does not exist or the session is already full.
 *  - `500` on internal server error.
 */
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

/**
 * End an active session: mark it completed, delete the associated Stream video call and chat channel, and respond with the updated session.
 *
 * Looks up the session by `req.params.id`, verifies the requester (`req.user._id`) is the host, updates the session status to "completed", and removes the session's streaming and chat resources.
 *
 * @param {import('express').Request} req - Express request. Expects `req.params.id` (session id) and `req.user._id` (requesting user id).
 * @param {import('express').Response} res - Express response used to send HTTP status and JSON body.
 */
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

