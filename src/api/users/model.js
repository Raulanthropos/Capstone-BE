import mongoose from "mongoose";
import bcrypt from "bcrypt";

const {Schema, model} = mongoose;

const userSchema = new Schema (
    {
      name: { type: String, required: true },
      surname: {type: String, required: true},
      age: {type: Number, required: true},
      email: { type: String, required: true },
      password: { type: String, required: true },
      picture: {type: String, required: false, default: "https://unsplash.com/photos/85J99sGggnw"},
      role: {type: String, enum: ["admin", "user"], required: true, default: "user"},
      description: {type: String, required: true} /*
  
   For the shelter to determine if they want to interview the user for a potential match
  
  */
    },
    { timestamps: true }
    )
 
    userSchema.pre("save", async function (next) {
      const currentUser = this
      if (currentUser.isModified("password")) {
        const plainPW = currentUser.password
        const hash = await bcrypt.hash(plainPW, 11)
        currentUser.password = hash
      }
      next()
    })

  userSchema.methods.toJSON = function () {
    const userDoc = this;
    console.log(userDoc);
    const user = userDoc.toObject();
    delete user.password;
    delete user.createdAt;
    delete user.updatedAt;
    delete user.__v;
    return user;
  };
  
  userSchema.static("checkCredentials", async function (email, plainPassword) {
    const user = await this.findOne({ email })
  
    if (user) {
      const isMatch = await bcrypt.compare(plainPassword, user.password)
  
      if (isMatch) {
        return user
      } else {
        return null
      }
    } else {
      return null
    }
  })
  

  export default model("User", userSchema);