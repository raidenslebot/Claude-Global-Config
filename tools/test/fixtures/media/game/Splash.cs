// Landing splash: the moment a swimmer hits the water. Fixture for the engine
// vocabulary — juice, camera, palette, and variation per instance.
using UnityEngine;
using UnityEngine.Rendering;
using TMPro;

public class Splash : MonoBehaviour
{
    [SerializeField] ParticleSystem spray;
    [SerializeField] AudioSource audioSource;
    [SerializeField] AudioClip[] impacts;
    [SerializeField] Light2D causticLight;
    [SerializeField] Material waterShader;          // dissolve + palette swap
    [SerializeField] AnimationCurve landCurve;
    [SerializeField] TMP_Text depthLabel;
    [SerializeField] VolumeProfile grade;           // the ColorGrading LUT
    [SerializeField] Texture2D normalMap;

    Vector3 baseScale;
    float trauma;

    void Awake()
    {
        baseScale = transform.localScale;
        // Variation per instance: this prop never appears twice identically.
        var variant = Random.Range(0, 3);
        waterShader.SetFloat("_Posterize", 4 + variant);
        waterShader.shader = Shader.Find("Harbour/WaterSurface");
        waterShader.SetTexture("_NormalMap", normalMap);
    }

    public void Land(float speed)
    {
        StartCoroutine(HitStop(0.055f));
        trauma = Mathf.Clamp01(trauma + speed * 0.25f);
        spray.Emit((int)(12 + speed * 40));

        // Squash on impact, released along an authored curve rather than a lerp.
        transform.localScale = new Vector3(baseScale.x * 1.22f, baseScale.y * 0.78f, baseScale.z);

        var clip = impacts[Random.Range(0, impacts.Length)];
        audioSource.pitch = Random.Range(0.92f, 1.08f);
        audioSource.PlayOneShot(clip);

        depthLabel.text = $"{speed:0.0} m/s";
    }

    System.Collections.IEnumerator HitStop(float seconds)
    {
        // A few frames of frozen time: the largest perceived-weight gain there is.
        Time.timeScale = 0f;
        yield return new WaitForSecondsRealtime(seconds);
        Time.timeScale = 1f;
    }

    void LateUpdate()
    {
        trauma = Mathf.Max(0f, trauma - Time.deltaTime * 1.6f);
        var shake = trauma * trauma;

        // Camera with lead and a deadzone: most of what feels good is the camera.
        var lookAhead = transform.right * 1.4f;
        var deadzone = 0.35f;
        var target = transform.position + lookAhead;
        var cam = Camera.main.transform;
        if (Vector3.Distance(cam.position, target) > deadzone)
            cam.position = Vector3.Lerp(cam.position, target, Time.deltaTime * 4f);
        cam.position += (Vector3)Random.insideUnitCircle * shake * 0.4f;

        transform.localScale = Vector3.Lerp(transform.localScale, baseScale, landCurve.Evaluate(Time.deltaTime * 8f));
        causticLight.intensity = 0.8f + Mathf.PerlinNoise(Time.time * 0.7f, 0f) * 0.35f;
    }
}
