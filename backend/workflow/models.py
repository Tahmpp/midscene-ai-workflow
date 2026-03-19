from django.db import models
from django.utils import timezone

class TestCase(models.Model):
    """
    Parsed test case from Excel row.
    """
    case_id = models.CharField(max_length=50, unique=True, help_text="Test Case ID from Excel")
    title = models.CharField(max_length=200, help_text="Test Case Title")
    description = models.TextField(blank=True, help_text="Test Case Description")
    preconditions = models.TextField(blank=True, null=True)
    steps = models.TextField(help_text="Raw steps from Excel")
    expected_result = models.TextField(help_text="Expected result from Excel")
    priority = models.CharField(max_length=20, default='Medium')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.case_id} - {self.title}"

class GeneratedScript(models.Model):
    """
    AI Generated Midscene YAML script for a test case.
    """
    test_case = models.OneToOneField(TestCase, on_delete=models.CASCADE, related_name='script')
    yaml_content = models.TextField(help_text="Generated YAML content")
    status = models.CharField(max_length=20, choices=[
        ('pending', 'Pending'),
        ('generating', 'Generating'),
        ('completed', 'Completed'),
        ('failed', 'Failed')
    ], default='pending')
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Script for {self.test_case.case_id}"

class TestRun(models.Model):
    """
    A batch execution of test cases.
    """
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('completed', 'Completed'),
        ('stopped', 'Stopped'),
    ]
    
    start_time = models.DateTimeField(default=timezone.now)
    end_time = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    total_cases = models.IntegerField(default=0)
    passed_cases = models.IntegerField(default=0)
    failed_cases = models.IntegerField(default=0)
    
    def __str__(self):
        return f"Run {self.id} - {self.status}"

class TestResult(models.Model):
    """
    Execution result of a single test case in a run.
    """
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('success', 'Success'),
        ('failed', 'Failed'),
        ('skipped', 'Skipped'),
    ]

    run = models.ForeignKey(TestRun, on_delete=models.CASCADE, related_name='results')
    test_case = models.ForeignKey(TestCase, on_delete=models.CASCADE)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    start_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)
    duration = models.FloatField(default=0.0, help_text="Duration in seconds")
    log_content = models.TextField(blank=True, help_text="Execution logs")
    error_message = models.TextField(blank=True, null=True)
    screenshot_path = models.CharField(max_length=500, blank=True, null=True)
    video_path = models.CharField(max_length=500, blank=True, null=True)
    # Midscene 原生报告路径
    report_path = models.CharField(max_length=500, blank=True, null=True, help_text="Midscene HTML report path")

    def __str__(self):
        return f"{self.test_case.case_id} - {self.status}"
