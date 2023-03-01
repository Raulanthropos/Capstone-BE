import mongoose from "mongoose";

const {Schema, model} = mongoose;

const dogSchema = new Schema(
    {
      name: { type: String, required: true },
      breed: { type: String, required: true },
      age: { type: Number, required: true },
      images: [
        {
          fileName: { type: String, required: true },
          size: { type: Number, required: true },
          type: { type: String, required: true }
        }
      ],
      location: { type: String, required: true },
      description: { type: String, required: true },
      isAdopted: { type: Boolean, required: true, default: false },
      isNeutered: { type: Boolean, required: true, default: false }
    },
    { timestamps: true }
  );
  


  export default model("Dog", dogSchema);