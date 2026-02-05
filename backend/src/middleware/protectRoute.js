import { requireAuth } from '@clerk/express'
import User from "../models/User.js"

export const protectRoute = [
    requireAuth(), // requireAuth({signInUrl: "/sign-in"}) dont let requireAuth() to take us to home page

    async (req, res, next) => {
        try {
            const clerkID = req.auth().userId;
            if (!clerkID) return res.status(401).json({ msg: "Unauthorized - invalid token" })

            //find user in db by clerk ID
            const user = await User.findOne({ clerkID })

            if (!user) return res.status(404).json({ msg: "User not found" })

            //attach user to req
            req.user = user;

            next()

        } catch (error) {
            console.error("Error in protectRoute middleware", error)
            res.status(500).json({ message: "Internal Server Error" })


        }
    }
]