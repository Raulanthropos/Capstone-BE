import mongoose from "mongoose";

const {Schema, model} = mongoose;

const userSchema = new Schema (
    {
      name: { type: String, required: true },
      surname: {type: String, required: true},
      age: {type: Number, required: true},
      email: { type: String, required: true },
      password: { type: String, required: true },
      picture: {type: String, required: false, default: "https://unsplash.com/photos/85J99sGggnw"},
      description: {type: String, required: true} /*
  
   For the shelter to determine if they want to interview the user for a potential match
  
  */
    },
    { timestamps: true }
  )

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

  export default model("User", userSchema);