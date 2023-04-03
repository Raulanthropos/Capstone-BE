import mongoose from "mongoose";

const {Schema, model} = mongoose;

const adoptionSchema = new Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  dog: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Dog",
    required: true
  }
});

export default model("Adoption", adoptionSchema);