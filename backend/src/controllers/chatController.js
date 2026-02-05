import { chatClient } from "../lib/stream.js";

export async function getStreamToken(req, res) {
    try {

        //use clerkID for stream (not mongodb _id)=> it should match the id we have in the stream
        const token = chatClient.createToken(req.user.clerkID)

        res.status(200).json({
            token,
            userId: req.user.clerkID,
            userName: req.user.name,
            userImage: req.user.image,
        })
    } catch (error) {
        console.log("Error in getStreamToken controller", error.message)
        res.status(500).json({ message: "Internal Server Error" })

    }
}